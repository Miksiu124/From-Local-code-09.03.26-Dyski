-- Revert PLN to USD (divide by 4)
UPDATE credit_packages SET price = price / 4;
UPDATE credit_purchases SET amount = amount / 4;
