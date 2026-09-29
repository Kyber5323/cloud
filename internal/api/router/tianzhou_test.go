package router

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/wanglongan587/cloud/internal/core"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestTianzhouSearchSendsMachineHeadersAndProjectsOnlyEmployedPeople(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Scheme != "https" || req.URL.Query().Get("keyword") != "严霜洲" || req.Header.Get("X_HW_ID") != "id" || req.Header.Get("tianzhou-env") != "prod" || req.Header.Get("X_HW_APPKEY") != "secret" {
			t.Error("Tianzhou request did not use the configured machine authentication")
		}
		body := `{"code":"0","data":[{"globalUserId":"205045249610656","name":"严霜洲","employeeNumber":"00934887","departmentName":"研发","employedFlag":"1","email":"private@example.invalid"},{"globalUserId":"2","name":"离职","employeeNumber":"2","employedFlag":"0"}]}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	directory, err := NewTianzhouClient("https://tianzhou.huawei.com/api/framework/v1/user/search", "id", "prod", "secret", client)
	if err != nil {
		t.Fatal(err)
	}
	people, err := directory.Search(context.Background(), "严霜洲")
	if err != nil {
		t.Fatal(err)
	}
	if len(people) != 1 || people[0].GlobalUserID != "205045249610656" || people[0].Name != "严霜洲" || people[0].DepartmentName != "研发" || !people[0].Employed {
		t.Fatalf("unexpected projected result: %+v", people)
	}
}

func TestTianzhouSearchFailsClosedOnUpstreamFailure(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("upstream private detail")), Header: make(http.Header)}, nil
	})}
	directory, err := NewTianzhouClient("https://tianzhou.huawei.com/api/framework/v1/user/search", "id", "prod", "secret", client)
	if err != nil {
		t.Fatal(err)
	}
	_, err = directory.Search(context.Background(), "张三")
	if fault := core.ErrorCode(err); fault.Status != 503 || fault.Code != "directory_unavailable" || strings.Contains(err.Error(), "private") {
		t.Fatalf("unsafe upstream failure: %v", err)
	}
}
