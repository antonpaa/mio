# Managed Postgres (WP-09): Cloud SQL for PostgreSQL 17, private IP
# only, automated backups with PITR. The application's role model
# (mio_owner running migrations, NOLOGIN carrier roles mio_app /
# mio_worker / mio_audit_reader) is created BY the migrations - the
# module provisions only the instance, the database and the login user
# the deploy pipeline connects as.

variable "project" { type = string }
variable "region" { type = string }
variable "env" { type = string }
variable "network_id" { type = string }
variable "private_vpc_connection" { type = string }
variable "tier" {
  type    = string
  default = "db-custom-1-3840"
}

resource "google_sql_database_instance" "postgres" {
  project          = var.project
  name             = "mio-${var.env}"
  region           = var.region
  database_version = "POSTGRES_17"

  settings {
    tier              = var.tier
    availability_type = var.env == "staging" ? "ZONAL" : "ZONAL"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }

  # depends on private services access being in place
  depends_on          = [var.private_vpc_connection]
  deletion_protection = true
}

resource "google_sql_database" "mio" {
  project  = var.project
  instance = google_sql_database_instance.postgres.name
  name     = "mio"
}

resource "random_password" "owner" {
  length  = 32
  special = false
}

# the migration/owner login; carrier roles come from 0001_foundation.sql
resource "google_sql_user" "owner" {
  project  = var.project
  instance = google_sql_database_instance.postgres.name
  name     = "mio_owner"
  password = random_password.owner.result
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project
  secret_id = "mio-${var.env}-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = "postgres://mio_owner:${random_password.owner.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/mio"
}

output "instance_connection_name" { value = google_sql_database_instance.postgres.connection_name }
output "private_ip" { value = google_sql_database_instance.postgres.private_ip_address }
output "database_url_secret" { value = google_secret_manager_secret.database_url.secret_id }
