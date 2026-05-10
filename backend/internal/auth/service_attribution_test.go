package auth

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func TestTryBackfillCustomLinkFromCookie_InactiveOrMissing(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	s := &Service{db: mock}

	linkID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(linkID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	if err := s.TryBackfillCustomLinkFromCookie(ctx, "user-1", linkID); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryBackfillCustomLinkFromCookie_ActiveLink_UpdatesOnce(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	s := &Service{db: mock}

	linkID := "660e8400-e29b-41d4-a716-446655440001"
	uid := "user-2"
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(linkID).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`UPDATE users SET custom_link_id`).
		WithArgs(linkID, uid).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := s.TryBackfillCustomLinkFromCookie(ctx, uid, linkID); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryAttachReferralFromCookieAfterLogin_CreatesRow(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	s := &Service{db: mock, redis: nil}

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("u9").
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT id FROM users WHERE referral_code`).
		WithArgs("ZZZ", "u9").
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow("referrer-z"))
	mock.ExpectExec(`INSERT INTO referrals`).
		WithArgs("referrer-z", "u9").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	if err := s.TryAttachReferralFromCookieAfterLogin(ctx, "u9", "zzz", "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryBackfillCustomLinkFromCookie_EmptyInputs(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	s := &Service{db: mock}

	if err := s.TryBackfillCustomLinkFromCookie(ctx, "", "x"); err != nil {
		t.Fatal(err)
	}
	if err := s.TryBackfillCustomLinkFromCookie(ctx, "u", ""); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
