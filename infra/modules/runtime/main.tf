# Runtime (WP-09): Cloud Run v2 for the API and the worker, one service
# account each with the narrowest grants that work - the API reads
# secrets and the bucket; the worker additionally nothing more. Images
# come from Artifact Registry; the deploy pipeline supplies the tag.

variable "project" { type = string }
variable "region" { type = string }
variable "env" { type = string }
variable "connector_id" { type = string }
variable "database_url_secret" { type = string }
variable "bucket_name" { type = string }
variable "api_image" { type = string }
variable "worker_image" { type = string }
variable "public_base_url" { type = string }

resource "google_artifact_registry_repository" "images" {
  project       = var.project
  location      = var.region
  repository_id = "mio-${var.env}"
  format        = "DOCKER"
}

resource "google_service_account" "api" {
  project      = var.project
  account_id   = "mio-${var.env}-api"
  display_name = "Mio API (${var.env})"
}

resource "google_service_account" "worker" {
  project      = var.project
  account_id   = "mio-${var.env}-worker"
  display_name = "Mio worker (${var.env})"
}

resource "google_secret_manager_secret_iam_member" "api_database_url" {
  project   = var.project
  secret_id = var.database_url_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_database_url" {
  project   = var.project
  secret_id = var.database_url_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "api_bucket" {
  bucket = var.bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "worker_bucket" {
  bucket = var.bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

locals {
  common_env = [
    { name = "MIO_GCS_BUCKET", value = var.bucket_name },
    { name = "MIO_PUBLIC_BASE_URL", value = var.public_base_url },
  ]
}

resource "google_cloud_run_v2_service" "api" {
  project  = var.project
  location = var.region
  name     = "mio-${var.env}-api"
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = var.env == "staging" ? 1 : 0
      max_instance_count = 4
    }
    vpc_access {
      connector = var.connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.api_image
      ports {
        container_port = 3000
      }
      env {
        name = "MIO_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret
            version = "latest"
          }
        }
      }
      env {
        name = "MIO_OTP_PEPPER"
        value_source {
          secret_key_ref {
            secret  = "mio-${var.env}-otp-pepper"
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service" "worker" {
  project  = var.project
  location = var.region
  name     = "mio-${var.env}-worker"
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.worker.email
    scaling {
      # the worker is a poller, not a request server: exactly one
      min_instance_count = 1
      max_instance_count = 1
    }
    vpc_access {
      connector = var.connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.worker_image
      env {
        name = "MIO_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = local.common_env
        content {
          name  = env.value.name
          value = env.value.value
        }
      }
    }
  }
}

output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "registry" {
  value = "${var.region}-docker.pkg.dev/${var.project}/${google_artifact_registry_repository.images.repository_id}"
}
