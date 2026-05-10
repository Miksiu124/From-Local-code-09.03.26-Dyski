package jobs

import (
	"log"
	"time"

	"github.com/robfig/cron/v3"
)

type Scheduler struct {
	cron *cron.Cron
}

func NewScheduler() *Scheduler {
	return &Scheduler{
		cron: cron.New(),
	}
}

// NewSchedulerWithLocation runs cron specs in the given timezone (e.g. Europe/Warsaw for local midnight jobs).
func NewSchedulerWithLocation(loc *time.Location) *Scheduler {
	if loc == nil {
		loc = time.UTC
	}
	return &Scheduler{
		cron: cron.New(cron.WithLocation(loc)),
	}
}

func (s *Scheduler) Start() {
	s.cron.Start()
	log.Println("[Jobs] Scheduler started")
}

func (s *Scheduler) Stop() {
	s.cron.Stop()
	log.Println("[Jobs] Scheduler stopped")
}

func (s *Scheduler) AddJob(spec string, cmd func()) (cron.EntryID, error) {
	return s.cron.AddFunc(spec, cmd)
}
