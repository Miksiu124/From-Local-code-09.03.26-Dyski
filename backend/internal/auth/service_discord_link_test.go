package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func TestLinkDiscordToUser_Success(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	s := &Service{db: mock}
	userID := "user-1"
	discordID := "discord-1"

	mock.ExpectQuery(`SELECT COALESCE\(\(SELECT id::text FROM users WHERE discord_id = \$1 LIMIT 1\), ''\)`).
		WithArgs(discordID).
		WillReturnRows(pgxmock.NewRows([]string{"coalesce"}).AddRow(""))
	mock.ExpectExec(`UPDATE users`).
		WithArgs(discordID, pgxmock.AnyArg(), userID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := s.LinkDiscordToUser(ctx, userID, discordID, "avatar123"); err != nil {
		t.Fatalf("LinkDiscordToUser failed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLinkDiscordToUser_DiscordBelongsToAnotherUser(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	s := &Service{db: mock}
	userID := "user-1"
	discordID := "discord-1"

	mock.ExpectQuery(`SELECT COALESCE\(\(SELECT id::text FROM users WHERE discord_id = \$1 LIMIT 1\), ''\)`).
		WithArgs(discordID).
		WillReturnRows(pgxmock.NewRows([]string{"coalesce"}).AddRow("user-2"))

	err = s.LinkDiscordToUser(ctx, userID, discordID, "")
	if !errors.Is(err, ErrDiscordAlreadyLinkedToAnotherAccount) {
		t.Fatalf("expected ErrDiscordAlreadyLinkedToAnotherAccount, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
