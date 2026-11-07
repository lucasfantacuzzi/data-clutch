package redisx

import (
	"context"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"data-clutch/internal/conn"
)

func TestSplitCommand(t *testing.T) {
	got, err := SplitCommand(`SET "a b" 'c d' e\ f ""`)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"SET", "a b", "c d", `e\`, "f", ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%q", got)
	}
	if _, err := SplitCommand(`GET "x`); err == nil {
		t.Fatal("want error")
	}
}

func TestRedisIntegration(t *testing.T) {
	addr := os.Getenv("CLUTCH_REDIS")
	if addr == "" {
		t.Skip("CLUTCH_REDIS not set")
	}
	host, port, _ := strings.Cut(addr, ":")
	p, _ := strconv.Atoi(port)
	ctx := context.Background()

	rw, err := Driver{}.Dial(ctx, conn.Config{Host: host, Port: p, Database: "0"})
	if err != nil {
		t.Fatal(err)
	}
	defer rw.Close()
	w := rw.(*Handle)
	w.Refresh(ctx)
	for _, c := range []string{`DEL h s`, `HSET h f1 v1 f2 v2`, `SET s hello`} {
		if _, err := w.Exec(ctx, c, 10); err != nil {
			t.Fatal(c, err)
		}
	}

	ro, err := Driver{}.Dial(ctx, conn.Config{Host: host, Port: p, Database: "0", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	r := ro.(*Handle)
	if err := r.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Exec(ctx, `SET s nope`, 10); err == nil {
		t.Fatal("write allowed on read-only")
	}
	if _, err := r.Exec(ctx, `FLUSHALL`, 10); err == nil {
		t.Fatal("flushall allowed on read-only")
	}
	res, err := r.Exec(ctx, `HGETALL h`, 10)
	if err != nil || len(res.Rows) != 2 || res.Columns[0].Name != "field" {
		t.Fatalf("%v %+v", err, res)
	}
	res, err = r.Exec(ctx, `GET s`, 10)
	if err != nil || res.Rows[0][0] != "hello" {
		t.Fatalf("%v %+v", err, res)
	}
	page, err := r.Scan(ctx, "*", 0, 100)
	if err != nil || len(page.Keys) < 2 {
		t.Fatalf("%v %+v", err, page)
	}
	for _, k := range page.Keys {
		if k.Key == "h" && k.Type != "hash" {
			t.Fatalf("%+v", k)
		}
		if (k.Key == "h" || k.Key == "s") && k.TTL != -1 {
			t.Fatalf("ttl %+v", k)
		}
	}
}
