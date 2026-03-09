-- Convert stored prices from USD to PLN (4 PLN = 1 USD)
-- Admin will enter prices in PLN; frontend converts to USD for en locale
UPDATE credit_packages SET price = price * 4;
UPDATE credit_purchases SET amount = amount * 4;
