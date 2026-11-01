package domain_test

import (
	"testing"

	"reputation/internal/domain"
)

func TestClampScore(t *testing.T) {
	tests := []struct {
		input    int
		expected int
	}{
		{-10, 0},
		{0, 0},
		{500, 500},
		{1000, 1000},
		{1050, 1000},
	}

	for _, tt := range tests {
		got := domain.ClampScore(tt.input)
		if got != tt.expected {
			t.Errorf("ClampScore(%d) = %d; want %d", tt.input, got, tt.expected)
		}
	}
}

func TestLevelFor(t *testing.T) {
	tests := []struct {
		score           int
		expectedLevel   string
		expectedIndex   int
		hasNextLevel    bool
		expectedNext    int
		expectedProg    float64
	}{
		{0, "Novato", 0, true, 50, 0.0},
		{25, "Novato", 0, true, 50, 0.5},
		{49, "Novato", 0, true, 50, 0.98},
		{50, "Miembro", 1, true, 150, 0.0},
		{100, "Miembro", 1, true, 150, 0.5},
		{149, "Miembro", 1, true, 150, 0.99},
		{150, "Confiable", 2, true, 350, 0.0},
		{250, "Confiable", 2, true, 350, 0.5},
		{350, "Experto", 3, true, 700, 0.0},
		{525, "Experto", 3, true, 700, 0.5},
		{700, "Leyenda", 4, false, 0, 1.0},
		{1000, "Leyenda", 4, false, 0, 1.0},
	}

	for _, tt := range tests {
		info := domain.LevelFor(tt.score)
		if info.Level != tt.expectedLevel {
			t.Errorf("LevelFor(%d).Level = %s; want %s", tt.score, info.Level, tt.expectedLevel)
		}
		if info.LevelIndex != tt.expectedIndex {
			t.Errorf("LevelFor(%d).LevelIndex = %d; want %d", tt.score, info.LevelIndex, tt.expectedIndex)
		}
		if tt.hasNextLevel {
			if info.NextLevelAt == nil || *info.NextLevelAt != tt.expectedNext {
				t.Errorf("LevelFor(%d).NextLevelAt = %v; want %d", tt.score, info.NextLevelAt, tt.expectedNext)
			}
		} else {
			if info.NextLevelAt != nil {
				t.Errorf("LevelFor(%d).NextLevelAt = %v; want nil", tt.score, info.NextLevelAt)
			}
		}
		if info.Progress != tt.expectedProg {
			t.Errorf("LevelFor(%d).Progress = %v; want %v", tt.score, info.Progress, tt.expectedProg)
		}
	}
}
