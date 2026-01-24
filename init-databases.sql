-- ═══════════════════════════════════════════════════════════════════════════
-- DATABASE INITIALIZATION SCRIPT
-- Creates separate databases for each microservice (5 services)
-- ═══════════════════════════════════════════════════════════════════════════

-- Keycloak database
CREATE DATABASE keycloak;

-- Microservice databases (5 services)
CREATE DATABASE user_service;
CREATE DATABASE budget_service;
CREATE DATABASE requisition_service;
CREATE DATABASE vendor_service;
CREATE DATABASE order_payment_service;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE user_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE budget_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE requisition_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE vendor_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE order_payment_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO procurement;
