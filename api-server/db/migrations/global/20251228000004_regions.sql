-- +goose Up
CREATE TABLE available_regions (
    region_code region PRIMARY KEY,
    region_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO available_regions (region_code, region_name, is_active) VALUES
    ('ind1', 'India - Chennai', TRUE),
    ('usa1', 'USA - California', TRUE),
    ('deu1', 'Germany - Frankfurt', TRUE),
    ('sgp1', 'Singapore', FALSE);

-- +goose Down
DROP TABLE IF EXISTS available_regions;
