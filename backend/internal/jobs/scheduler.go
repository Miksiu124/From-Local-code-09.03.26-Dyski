package jobs

import (
	"log"

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
