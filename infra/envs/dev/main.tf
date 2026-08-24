# Staging (WP-09): the composed environment. State lives in a GCS
# bucket bootstrapped once by hand (see infra/README.md).

terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "gcs" {
    # bucket + prefix supplied via -backend-config (see README)
  }
}

variable "project" { type = string }
variable "region" {
  type    = string
  default = "europe-north1"
}
variable "api_image" { type = string }
variable "worker_image" { type = string }
variable "public_base_url" { type = string }

provider "google" {
  project = var.project
  region  = var.region
}

module "network" {
  source  = "../../modules/network"
  project = var.project
  region  = var.region
  env     = "dev"
}

module "database" {
  source                 = "../../modules/database"
  project                = var.project
  region                 = var.region
  env                    = "dev"
  network_id             = module.network.network_id
  private_vpc_connection = module.network.private_vpc_connection
}

module "storage" {
  source  = "../../modules/storage"
  project = var.project
  region  = var.region
  env     = "dev"
}

module "runtime" {
  source              = "../../modules/runtime"
  project             = var.project
  region              = var.region
  env                 = "dev"
  connector_id        = module.network.connector_id
  database_url_secret = module.database.database_url_secret
  bucket_name         = module.storage.bucket_name
  api_image           = var.api_image
  worker_image        = var.worker_image
  public_base_url     = var.public_base_url
}

output "api_url" { value = module.runtime.api_url }
output "registry" { value = module.runtime.registry }
output "sql_connection" { value = module.database.instance_connection_name }
