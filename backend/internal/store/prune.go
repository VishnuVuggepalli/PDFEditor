package store

import (
	"log/slog"
	"os"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// prunePlan applies the keep-last-N retention policy to a version history and
// returns the surviving entries plus the version numbers to delete.
//
// Semantics:
//   - max <= 0 means unlimited: nothing is ever pruned.
//   - Otherwise at most max entries are kept, dropping the oldest first.
//   - Two hard guarantees override the cap: v1 (the original upload) and the
//     current head version always survive. With max == 1 a document therefore
//     still keeps two versions once it has been edited.
//   - Survivors keep their numbers (no renumbering), so histories may have
//     gaps (e.g. v1, v17..v37). Relative order is preserved: the head entry
//     stays last.
//
// versions must be ordered oldest-first with the head entry last, which is
// the invariant AddVersion maintains.
func prunePlan(versions []document.Version, headN, max int) (kept []document.Version, pruned []int) {
	if max <= 0 || len(versions) <= max {
		return versions, nil
	}
	excess := len(versions) - max
	kept = make([]document.Version, 0, max)
	for _, v := range versions {
		if excess > 0 && v.N != 1 && v.N != headN {
			pruned = append(pruned, v.N)
			excess--
			continue
		}
		kept = append(kept, v)
	}
	return kept, pruned
}

// removePrunedVersionFiles deletes the on-disk artifacts of pruned versions:
// each vK.pdf and its cached thumbnails (best effort; meta.json no longer
// references these versions, so failures only leave orphaned files behind).
func (s *FSStore) removePrunedVersionFiles(id string, ns []int) {
	for _, n := range ns {
		if err := os.Remove(s.versionPath(id, n)); err != nil && !os.IsNotExist(err) {
			slog.Warn("prune: remove version file failed", "doc", id, "version", n, "err", err)
		}
		s.removeVersionThumbs(id, n)
	}
}
