package domain

import (
	"math"
)

type LevelInfo struct {
	Level       string
	LevelIndex  int
	NextLevelAt *int
	Progress    float64
}

// ClampScore clamps the score within [0, 1000].
func ClampScore(score int) int {
	if score < 0 {
		return 0
	}
	if score > 1000 {
		return 1000
	}
	return score
}

// LevelFor returns level name, level index, nextLevelAt threshold, and progress towards next level.
func LevelFor(score int) LevelInfo {
	score = ClampScore(score)

	var level string
	var levelIndex int
	var nextLevelAt *int
	var progress float64

	switch {
	case score < 50:
		level = "Novato"
		levelIndex = 0
		next := 50
		nextLevelAt = &next
		progress = float64(score) / 50.0
	case score < 150:
		level = "Miembro"
		levelIndex = 1
		next := 150
		nextLevelAt = &next
		progress = float64(score-50) / 100.0
	case score < 350:
		level = "Confiable"
		levelIndex = 2
		next := 350
		nextLevelAt = &next
		progress = float64(score-150) / 200.0
	case score < 700:
		level = "Experto"
		levelIndex = 3
		next := 700
		nextLevelAt = &next
		progress = float64(score-350) / 350.0
	default:
		level = "Leyenda"
		levelIndex = 4
		nextLevelAt = nil
		progress = 1.0
	}

	// Round progress to 2 decimal places and clamp [0.0, 1.0]
	if progress < 0.0 {
		progress = 0.0
	} else if progress > 1.0 {
		progress = 1.0
	}
	progress = math.Round(progress*100) / 100

	return LevelInfo{
		Level:       level,
		LevelIndex:  levelIndex,
		NextLevelAt: nextLevelAt,
		Progress:    progress,
	}
}
