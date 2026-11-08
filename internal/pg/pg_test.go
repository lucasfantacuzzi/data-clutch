package pg

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"data-clutch/internal/conn"
)

func TestConnStringEscapesCredentials(t *testing.T) {
	cfg := conn.Config{Host: "db.local", Port: 5433, User: "us@er:x", Password: "p@ss/w:rd?#% &=", Database: "my db?x#y", SSLMode: "require"}
	pc, err := pgx.ParseConfig(connString(cfg))
	if err != nil {
		t.Fatal(err)
	}
	if pc.User != cfg.User || pc.Password != cfg.Password || pc.Database != cfg.Database || pc.Host != cfg.Host || pc.Port != 5433 {
		t.Errorf("round trip mismatch: %q %q %q %q %d", pc.User, pc.Password, pc.Database, pc.Host, pc.Port)
	}
	if pc.TLSConfig == nil {
		t.Error("sslmode=require should set a TLS config")
	}
}
