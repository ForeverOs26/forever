# Legacy controlled SQL

`20260718100000_coralina_prerequisite_execution_boundary.sql` was prepared for
the RC5.6P Coralina prerequisite workflow. It was never applied to production:
RC5.6P stopped before credential handoff and before any write.

Progressive Ingestion replaced that prerequisite-blocking model. The preserved
SQL is historical/optional evidence only. It must not be copied back into
`supabase/migrations`, included in an automatic migration chain, or applied
automatically.

Any future use requires separate, explicit owner authorization and a new
repository review. The archived SQL is preserved byte-for-byte; keep explanatory
material in this README rather than editing the evidence file.
