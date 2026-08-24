# Object storage (WP-09): the attachment bucket behind @mio/storage's
# GCS adapter. Uniform access, no public grants ever, optional CMEK -
# the application serves bytes itself after authorization, so the bucket
# needs no web exposure at all.

variable "project" { type = string }
variable "region" { type = string }
variable "env" { type = string }
variable "kms_key" {
  type        = string
  default     = null
  description = "optional customer-managed encryption key"
}

resource "google_storage_bucket" "attachments" {
  project                     = var.project
  name                        = "${var.project}-mio-${var.env}-attachments"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  dynamic "encryption" {
    for_each = var.kms_key == null ? [] : [var.kms_key]
    content {
      default_kms_key_name = encryption.value
    }
  }

  # WP-29: the worker writes daily audit exports under audit-exports/ in
  # this bucket. Versioning keeps every overwritten or deleted object as
  # a noncurrent version - the export files gain tamper evidence, and a
  # rejected attachment's delete still succeeds (its bytes linger as a
  # noncurrent version until a lifecycle rule ages them out). A DEDICATED
  # bucket with a retention lock is the production endgame, but its lock
  # period IS the statutory retention period - blocked on R5, like every
  # other period in audit.retention_policy.
  versioning {
    enabled = true
  }
}

output "bucket_name" { value = google_storage_bucket.attachments.name }
