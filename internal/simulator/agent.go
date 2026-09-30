package simulator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"

	"github.com/wanglongan587/cloud/internal/controlgrpc"
	"github.com/wanglongan587/cloud/internal/controlpb"
)

// AgentNode is a disk-backed echo fixture, owned by one simulator Controller at a time.
// Its journal survives Controller replacement; it proves Cloud control flow, not real Agent execution.
type AgentNode struct{ root string }

type agentJournal struct {
	InputHash string
	Events    []*controlpb.ThreadEvent
	Commands  map[string]bool
	Ended     controlpb.AgentSessionEndReason
}

// NewAgentNode creates the isolated Node journal directory used by the echo fixture.
func NewAgentNode(root string) (*AgentNode, error) {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create echo Node journal: %w", err)
	}
	return &AgentNode{root: root}, nil
}

func (n *AgentNode) path(execution string) string {
	sum := sha256.Sum256([]byte(execution))
	return filepath.Join(n.root, hex.EncodeToString(sum[:])+".json")
}

func (n *AgentNode) load(record *controlpb.ExecutionRecord) (*agentJournal, error) {
	input, err := proto.MarshalOptions{Deterministic: true}.Marshal(record.GetInput())
	if err != nil {
		return nil, fmt.Errorf("encode echo input: %w", err)
	}
	sum := sha256.Sum256(input)
	hash := hex.EncodeToString(sum[:])
	j := &agentJournal{InputHash: hash, Commands: map[string]bool{}}
	data, err := os.ReadFile(n.path(record.GetExecutionId()))
	if err == nil {
		if err = json.Unmarshal(data, j); err != nil {
			return nil, fmt.Errorf("read echo journal: %w", err)
		}
		if j.InputHash != hash {
			return nil, fmt.Errorf("echo execution input conflict")
		}
		return j, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read echo journal: %w", err)
	}
	if session := record.GetInput().GetAgentSession(); session != nil {
		if err := j.echo(session.GetInitialTurn()); err != nil {
			return nil, err
		}
	}
	return j, n.save(record.GetExecutionId(), j)
}

func (n *AgentNode) save(execution string, j *agentJournal) error {
	data, err := json.Marshal(j)
	if err != nil {
		return fmt.Errorf("encode echo journal: %w", err)
	}
	file, err := os.CreateTemp(n.root, "journal-*")
	if err != nil {
		return fmt.Errorf("create echo journal: %w", err)
	}
	name := file.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return fmt.Errorf("write echo journal: %w", err)
	}
	if closeErr != nil {
		return fmt.Errorf("close echo journal: %w", closeErr)
	}
	if err = os.Rename(name, n.path(execution)); err != nil {
		return fmt.Errorf("replace echo journal: %w", err)
	}
	return nil
}

func (j *agentJournal) echo(turn *controlpb.UserTurn) error {
	text := ""
	for _, block := range turn.GetContent() {
		text += block.GetText().GetText()
	}
	data, err := json.Marshal(map[string]string{"kind": "assistant", "text": text})
	if err != nil {
		return fmt.Errorf("encode echo record: %w", err)
	}
	id := turn.GetTurnId()
	j.Events = append(j.Events, &controlpb.ThreadEvent{Sequence: uint64(len(j.Events) + 1), TurnId: &id, Record: string(data)})
	return nil
}

func (n *AgentNode) accept(record *controlpb.ExecutionRecord, command *controlpb.ThreadCommand) error {
	j, err := n.load(record)
	if err != nil {
		return err
	}
	if j.Commands[command.GetCommandId()] {
		return nil
	}
	if j.Ended == controlpb.AgentSessionEndReason_AGENT_SESSION_END_REASON_UNSPECIFIED {
		if turn := command.GetSubmitUserTurn(); turn != nil {
			if err := j.echo(turn.GetTurn()); err != nil {
				return err
			}
		} else {
			j.Ended = controlpb.AgentSessionEndReason(command.GetEndSession().GetReason())
		}
	}
	j.Commands[command.GetCommandId()] = true
	return n.save(record.GetExecutionId(), j)
}

// stepAgentWork uses the same gRPC handoff as a real Controller. Idle echo sessions remain pending;
// only a durable end command ends them. Delivery deliberately reports failure until M3 has a real
// uploader, so the fixture cannot masquerade as verified storage.
func (c *Controller) stepAgentWork(ctx context.Context) (bool, error) {
	if c.Executions == nil {
		return true, nil
	}
	ctx = metadata.AppendToOutgoingContext(ctx, controlgrpc.HolderMetadata, c.Client.Subject)
	claimed, err := c.Executions.ClaimWork(ctx, &controlpb.ClaimWorkRequest{Epoch: c.Epoch})
	if err != nil {
		return false, err
	}
	progress := false
	if item := claimed.GetItem(); item != nil && item.GetTarget() != nil {
		if c.AgentNode == nil || c.AgentRuns == nil {
			return false, fmt.Errorf("simulator Agent Node and AgentRunService are required for run work")
		}
		execution := uuid.NewString()
		_, err = c.Executions.RecordDispatch(ctx, &controlpb.RecordDispatchRequest{SubmissionId: "dispatch-" + execution, Epoch: c.Epoch, OperationId: item.GetOperationId(), ExecutionId: execution, NodeId: item.GetTarget().GetNodeId(), Input: item.GetInput()})
		if err != nil {
			return false, fmt.Errorf("register echo execution: %w", err)
		}
		progress = true
	}
	if c.AgentNode == nil || c.AgentRuns == nil {
		return !progress, nil
	}
	commands, err := c.AgentRuns.ClaimThreadCommands(ctx, &controlpb.ClaimThreadCommandsRequest{Epoch: c.Epoch, Limit: 100})
	if err != nil {
		return false, fmt.Errorf("claim echo commands: %w", err)
	}
	for _, command := range commands.GetCommands() {
		record, err := c.Executions.GetDispatch(ctx, &controlpb.GetDispatchRequest{ExecutionId: command.GetExecutionId()})
		if err != nil {
			return false, err
		}
		if err := c.AgentNode.accept(record.GetRecord(), command); err != nil {
			return false, err
		}
		_, err = c.AgentRuns.RecordThreadCommandDelivered(ctx, &controlpb.RecordThreadCommandDeliveredRequest{SubmissionId: "accepted-" + command.GetCommandId(), Epoch: c.Epoch, CommandId: command.GetCommandId(), ExecutionId: command.GetExecutionId()})
		if err != nil {
			return false, fmt.Errorf("record echo command acceptance: %w", err)
		}
		progress = true
	}
	pending, err := c.Executions.ListPendingDispatches(ctx, &controlpb.ListPendingDispatchesRequest{})
	if err != nil {
		return false, err
	}
	for _, record := range pending.GetRecords() {
		if record.GetInput().GetAgentSession() == nil && record.GetInput().GetDeliverRevision() == nil {
			continue
		}
		changed, err := c.takeEchoEvidence(ctx, record)
		if err != nil {
			return false, err
		}
		progress = progress || changed
	}
	return !progress, nil
}

func (c *Controller) takeEchoEvidence(ctx context.Context, record *controlpb.ExecutionRecord) (bool, error) {
	j, err := c.AgentNode.load(record)
	if err != nil {
		return false, err
	}
	if record.GetInput().GetAgentSession() != nil {
		// Replaying the persisted prefix obtains the Cloud watermark without changing Node sequence.
		for start := 0; start < len(j.Events); start += 64 {
			end := min(start+64, len(j.Events))
			_, err = c.AgentRuns.TakeOverThreadEvents(ctx, &controlpb.TakeOverThreadEventsRequest{SubmissionId: fmt.Sprintf("echo-%s-%d-%d", record.GetExecutionId(), c.Epoch, end), Epoch: c.Epoch, OperationId: record.GetOperationId(), ExecutionId: record.GetExecutionId(), Events: j.Events[start:end]})
			if err != nil {
				return false, fmt.Errorf("take over echo events: %w", err)
			}
		}
		if j.Ended == controlpb.AgentSessionEndReason_AGENT_SESSION_END_REASON_UNSPECIFIED {
			return false, nil
		}
	}
	result := &controlpb.ExecutionResult{Node: &controlpb.NodeIdentity{NodeId: record.GetNodeId(), NodeIncarnationId: "echo-fixture"}}
	if record.GetInput().GetAgentSession() != nil {
		result.Outcome = &controlpb.ExecutionResult_AgentSessionEnded{AgentSessionEnded: &controlpb.AgentSessionEnded{Reason: j.Ended}}
	} else {
		result.Outcome = &controlpb.ExecutionResult_RevisionFailed{RevisionFailed: &controlpb.RevisionFailed{Reason: controlpb.RevisionFailureReason_REVISION_FAILURE_REASON_UPLOAD_FAILED}}
	}
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return false, err
	}
	_, err = c.Executions.TakeOverNodeEvent(ctx, &controlpb.TakeOverNodeEventRequest{SubmissionId: "echo-ended-" + record.GetExecutionId(), Epoch: c.Epoch, OperationId: record.GetOperationId(), ExecutionId: record.GetExecutionId(), Sequence: uint64(len(j.Events) + 1), Result: result, Event: data})
	if err != nil {
		return false, fmt.Errorf("take over echo terminal event: %w", err)
	}
	return true, nil
}
