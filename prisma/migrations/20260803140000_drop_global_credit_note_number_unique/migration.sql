-- Stage 2: the application now persists the full ARCA voucher identity and
-- the composite unique index was verified in production. The voucher number
-- is not globally unique across agencies, sales points and voucher types.
DROP INDEX IF EXISTS "CreditNote_credit_number_key";
