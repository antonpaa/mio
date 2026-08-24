# Network (WP-09): one VPC per environment plus the serverless connector
# Cloud Run uses to reach Cloud SQL's private address. Deliberately the
# portable minimum (ADR-0010): a VPC, a subnet, private services access.

variable "project" { type = string }
variable "region" { type = string }
variable "env" { type = string }

resource "google_compute_network" "vpc" {
  project                 = var.project
  name                    = "mio-${var.env}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  project       = var.project
  name          = "mio-${var.env}-main"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/24"
}

# private services access for Cloud SQL
resource "google_compute_global_address" "private_service_range" {
  project       = var.project
  name          = "mio-${var.env}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
}

resource "google_vpc_access_connector" "serverless" {
  project       = var.project
  name          = "mio-${var.env}-run"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.11.0.0/28"
  min_instances = 2
  max_instances = 3
}

output "network_id" { value = google_compute_network.vpc.id }
output "connector_id" { value = google_vpc_access_connector.serverless.id }
output "private_vpc_connection" { value = google_service_networking_connection.private_vpc.id }
