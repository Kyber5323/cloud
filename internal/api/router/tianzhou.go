package router

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wanglongan587/cloud/internal/core"
)

// Directory resolves people through a bounded, server-authenticated search.
// The router authorizes the actor before calling it and the core rechecks
// authorization when it writes the selected membership.
type Directory interface {
	Search(ctx context.Context, keyword string) ([]core.DirectoryPerson, error)
}

// TianzhouClient holds one configured upstream and machine credential. Browser
// cookies and caller-selected URLs never cross this boundary.
type TianzhouClient struct {
	endpoint string
	hwID     string
	env      string
	appKey   string
	client   *http.Client
}

// NewTianzhouClient validates the fixed endpoint and credential before use.
func NewTianzhouClient(endpoint, hwID, env, appKey string, client *http.Client) (*TianzhouClient, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Path != "/api/framework/v1/user/search" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("invalid Tianzhou endpoint")
	}
	if hwID == "" || env == "" || appKey == "" {
		return nil, fmt.Errorf("tianzhou machine credentials required")
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	return &TianzhouClient{endpoint: endpoint, hwID: hwID, env: env, appKey: appKey, client: client}, nil
}

type directoryResponse struct {
	Code string `json:"code"`
	Data []struct {
		GlobalUserID   string `json:"globalUserId"`
		Name           string `json:"name"`
		EmployeeNumber string `json:"employeeNumber"`
		DepartmentName string `json:"departmentName"`
		EmployedFlag   string `json:"employedFlag"`
	} `json:"data"`
}

// Search returns only the fields needed to select an active employee. Errors
// deliberately omit the upstream URL, keyword, body, and credential values.
func (c *TianzhouClient) Search(ctx context.Context, keyword string) ([]core.DirectoryPerson, error) {
	keyword = strings.TrimSpace(keyword)
	if len(keyword) < 2 || len(keyword) > 100 {
		return nil, &core.Fault{Code: "invalid_keyword", Status: 400, Params: core.Object{}}
	}
	u, _ := url.Parse(c.endpoint)
	q := u.Query()
	q.Set("keyword", keyword)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), http.NoBody)
	if err != nil {
		return nil, &core.Fault{Code: "directory_unavailable", Status: 503, Params: core.Object{}}
	}
	req.Header.Set("X_HW_ID", c.hwID)
	req.Header.Set("tianzhou-env", c.env)
	req.Header.Set("X_HW_APPKEY", c.appKey)
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, &core.Fault{Code: "directory_unavailable", Status: 503, Params: core.Object{}}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &core.Fault{Code: "directory_unavailable", Status: 503, Params: core.Object{}}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (64<<10)+1))
	if err != nil || len(body) > 64<<10 {
		return nil, &core.Fault{Code: "directory_unavailable", Status: 503, Params: core.Object{}}
	}
	var result directoryResponse
	if json.Unmarshal(body, &result) != nil || result.Code != "0" {
		return nil, &core.Fault{Code: "directory_unavailable", Status: 503, Params: core.Object{}}
	}
	people := make([]core.DirectoryPerson, 0, min(len(result.Data), 20))
	for _, person := range result.Data {
		if person.EmployedFlag != "1" || person.GlobalUserID == "" || len(person.Name) > 200 {
			continue
		}
		people = append(people, core.DirectoryPerson{GlobalUserID: person.GlobalUserID, Name: person.Name, EmployeeNumber: person.EmployeeNumber, DepartmentName: person.DepartmentName, Employed: true})
		if len(people) == 20 {
			break
		}
	}
	return people, nil
}
