package workspace

import (
	"io/fs"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const maxWatchedDirs = 1500

type watcher struct {
	fw   *fsnotify.Watcher
	done chan struct{}
	once sync.Once
}

func (w *watcher) close() { w.once.Do(func() { close(w.done); _ = w.fw.Close() }) }

func addTree(fw *fsnotify.Watcher, root string, budget *int) {
	_ = filepath.WalkDir(root, func(p string, de fs.DirEntry, err error) error {
		if err != nil || !de.IsDir() {
			return nil
		}
		if p != root && skipDir(de.Name()) {
			return filepath.SkipDir
		}
		if *budget <= 0 {
			return filepath.SkipAll
		}
		*budget--
		_ = fw.Add(p)
		return nil
	})
}

// startWatcher reports changed paths, coalesced over a short window. It returns
// nil if the OS cannot watch (inotify limits): callers then refresh by hand.
func startWatcher(root string, onChange func([]string)) *watcher {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil
	}
	budget := maxWatchedDirs
	addTree(fw, root, &budget)
	w := &watcher{fw: fw, done: make(chan struct{})}
	go func() {
		pending := map[string]bool{}
		var timer <-chan time.Time
		for {
			select {
			case <-w.done:
				return
			case ev, ok := <-fw.Events:
				if !ok {
					return
				}
				if ev.Has(fsnotify.Create) {
					left := budget
					addTree(fw, ev.Name, &left) // a new folder joins the watch; for a file this is a no-op
				}
				pending[ev.Name] = true
				if timer == nil {
					timer = time.After(200 * time.Millisecond)
				}
			case <-fw.Errors:
			case <-timer:
				paths := make([]string, 0, len(pending))
				for p := range pending {
					paths = append(paths, p)
				}
				pending, timer = map[string]bool{}, nil
				onChange(paths)
			}
		}
	}()
	return w
}
