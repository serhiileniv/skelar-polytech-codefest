package entity

import (
	"math"
	"time"
)

// Metrics is GET /api/metrics (brief capability 4: analyze interactions / score support).
type Metrics struct {
	TotalCases   int             `json:"totalCases"`
	Investigated int             `json:"investigated"`
	ByOutcome    map[Outcome]int `json:"byOutcome"`
	KeptFromTech int             `json:"keptFromTech"`
	Downgraded   int             `json:"downgraded"`
	AvgSteps     float64         `json:"avgSteps"`
	Actions      ActionCounts    `json:"actions"`
	Eval         *EvalResult     `json:"eval"`
}

type ActionCounts struct {
	Executed int `json:"executed"`
	Blocked  int `json:"blocked"`
}

type EvalResult struct {
	Correct int       `json:"correct"`
	Total   int       `json:"total"`
	RanAt   time.Time `json:"ranAt"`
}

// ComputeMetrics aggregates stored verdicts. Every outcome key is present (0 if none).
func ComputeMetrics(totalCases int, verdicts []Verdict, actions ActionCounts, eval *EvalResult) Metrics {
	m := Metrics{TotalCases: totalCases, Investigated: len(verdicts), ByOutcome: map[Outcome]int{}, Actions: actions, Eval: eval}
	for _, o := range Outcomes {
		m.ByOutcome[o] = 0
	}
	steps := 0
	for _, v := range verdicts {
		m.ByOutcome[v.Outcome]++
		if v.Outcome != OutcomeTechTeam {
			m.KeptFromTech++
		}
		if v.Downgraded {
			m.Downgraded++
		}
		steps += v.StepsUsed
	}
	if len(verdicts) > 0 {
		m.AvgSteps = math.Round(float64(steps)/float64(len(verdicts))*10) / 10
	}
	return m
}
