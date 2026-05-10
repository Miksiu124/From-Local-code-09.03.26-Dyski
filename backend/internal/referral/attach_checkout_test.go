package referral

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/redis/go-redis/v9"
)

func TestTryAttachReferralFromCodeAtCheckout_EmptyInputs_NoDB(t *testing.T) {
	ctx := context.Background()
	if err := TryAttachReferralFromCodeAtCheckout(ctx, nil, nil, "user-1", "", "10.0.0.1"); err != nil {
		t.Fatalf("empty ref: %v", err)
	}
	if err := TryAttachReferralFromCodeAtCheckout(ctx, nil, nil, "", "ABC", "10.0.0.1"); err != nil {
		t.Fatalf("empty user: %v", err)
	}
}

func TestTryAttachReferralFromCodeAtCheckout_AlreadyHasReferral(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	referee := "referee-1"
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(referee).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	if err := TryAttachReferralFromCodeAtCheckout(ctx, tx, nil, referee, "FRIEND", "10.0.0.2"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryAttachReferralFromCodeAtCheckout_UnknownCode(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	referee := "referee-2"
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(referee).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT id FROM users WHERE referral_code`).
		WithArgs("NOSUCH", referee).
		WillReturnError(pgx.ErrNoRows)

	if err := TryAttachReferralFromCodeAtCheckout(ctx, tx, nil, referee, "nosuch", "10.0.0.3"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryAttachReferralFromCodeAtCheckout_SameIPBlocked(t *testing.T) {
	ctx := context.Background()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	refereeUser := "referee-3"
	referrerID := "referrer-a"
	ip := "203.0.113.50"
	_ = mr.Set("session:ip:"+referrerID, ip)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(refereeUser).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT id FROM users WHERE referral_code`).
		WithArgs("PAL", refereeUser).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(referrerID))

	if err := TryAttachReferralFromCodeAtCheckout(ctx, tx, rdb, refereeUser, "pal", ip); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryAttachReferralFromCodeAtCheckout_InsertsRow(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	refereeUser := "referee-4"
	referrerID := "referrer-b"
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(refereeUser).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT id FROM users WHERE referral_code`).
		WithArgs("PAL", refereeUser).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(referrerID))
	mock.ExpectExec(`INSERT INTO referrals`).
		WithArgs(referrerID, refereeUser).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := TryAttachReferralFromCodeAtCheckout(ctx, tx, nil, refereeUser, "pal", "198.51.100.9"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTryAttachReferralFromCodeAtCheckout_PropagatesQueryError(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	referee := "referee-5"
	dbErr := errors.New("db down")
	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(referee).
		WillReturnError(dbErr)

	err = TryAttachReferralFromCodeAtCheckout(ctx, tx, nil, referee, "X", "10.0.0.1")
	if err != dbErr {
		t.Fatalf("want db err, got %v", err)
	}
}

func TestInsertReferralRowIdempotentTx_Exec(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()
	mock.ExpectBegin()
	tx, err := mock.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	mock.ExpectExec(`INSERT INTO referrals`).
		WithArgs("ref-a", "ref-b").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := InsertReferralRowIdempotentTx(ctx, tx, "ref-a", "ref-b"); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
