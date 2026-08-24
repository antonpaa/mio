# Observability (WP-32). Cloud Run and Cloud SQL emit their metrics on
# their own; what needs declaring is the judgement: what counts as
# wrong, and who hears about it. Three alerts and an uptime check - the
# minimal set that catches "it is down", "it is failing" and "it is
# drowning" - wired to a notification channel the environment supplies.

variable "project" { type = string }
variable "env" { type = string }
variable "api_service_name" { type = string }
variable "api_host" {
  type        = string
  description = "public hostname of the API service (uptime check target)"
}
variable "notification_channels" {
  type        = list(string)
  default     = []
  description = "monitoring notification channel IDs (email/pager); empty = alerts fire silently into the console"
}

resource "google_monitoring_uptime_check_config" "health" {
  project      = var.project
  display_name = "mio-${var.env} /health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project
      host       = var.api_host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  project      = var.project
  display_name = "mio-${var.env}: /health failing"
  combiner     = "OR"
  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "180s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MEAN"
      }
    }
  }
  notification_channels = var.notification_channels
}

resource "google_monitoring_alert_policy" "error_rate" {
  project      = var.project
  display_name = "mio-${var.env}: API 5xx rate"
  combiner     = "OR"
  conditions {
    display_name = "5xx responses over 5% for 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${var.api_service_name}\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = var.notification_channels
}

resource "google_monitoring_alert_policy" "latency" {
  project      = var.project
  display_name = "mio-${var.env}: API p95 latency"
  combiner     = "OR"
  conditions {
    display_name = "p95 request latency above 1s for 10 minutes"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${var.api_service_name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1000
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }
  notification_channels = var.notification_channels
}
