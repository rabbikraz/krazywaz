-- Migration: Add slug column for custom URLs
ALTER TABLE shiurim ADD COLUMN slug TEXT;
