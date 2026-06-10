package api

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the Gin engine with middleware and all v1 routes.
// allowedOrigins is the CORS allowlist; requests from other origins get no
// CORS headers (same-origin traffic through the nginx proxy is unaffected).
func NewRouter(h *Handlers, allowedOrigins []string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger(), cors(allowedOrigins))

	r.GET("/healthz", func(c *gin.Context) { c.String(200, "ok") })

	v1 := r.Group("/api/v1")
	{
		v1.POST("/documents", h.Upload)
		v1.GET("/documents", h.List)
		v1.GET("/documents/:id", h.Download)
		v1.PATCH("/documents/:id", h.Rename)
		v1.DELETE("/documents/:id", h.Delete)
		v1.GET("/documents/:id/meta", h.Meta)
		v1.GET("/documents/:id/thumbnail", h.Thumbnail)
		v1.GET("/documents/:id/versions", h.ListVersions)
		v1.GET("/documents/:id/versions/:n", h.DownloadVersion)
		v1.POST("/documents/:id/versions/:n/restore", h.RestoreVersion)
		v1.POST("/documents/:id/pages/ops", h.PageOps)
		v1.POST("/documents/:id/annotations", h.Annotate)
		v1.POST("/documents/:id/stamp", h.Stamp)
		v1.GET("/documents/:id/form", h.FormFields)
		v1.POST("/documents/:id/form", h.FillForm)
		v1.POST("/documents/:id/split", h.Split)
		v1.POST("/documents/merge", h.Merge)
	}
	return r
}

// requestLogger logs every request with slog (structured, one line each).
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"dur", time.Since(start).Round(time.Microsecond).String(),
		)
	}
}

// cors echoes the request Origin back only when it is on the allowlist
// (exact match), instead of a wildcard. Vary: Origin is always set so caches
// never serve one origin's CORS response to another.
func cors(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = struct{}{}
	}
	return func(c *gin.Context) {
		c.Header("Vary", "Origin")
		origin := c.GetHeader("Origin")
		if _, ok := allowed[origin]; ok {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
		}
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
