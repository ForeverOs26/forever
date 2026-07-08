# Forever Data Standard

Version: 1.0

Status: Official Standard

## Purpose

The Forever Data Standard defines the canonical structure every Forever project must follow before it can be imported, evaluated, displayed, or reused across Forever interfaces.

Forever data must be:

- Structured
- Source-backed
- Explainable
- Reusable
- Importable
- Safe to validate

Absent facts must remain absent. Do not guess, infer, or copy facts from another project.

## 1. Project Entity

The Project Entity is the canonical parent record for every property project.

### Required Fields

- Project name
- Project slug
- Developer
- Country
- Province
- Location / area
- Project type
- Public status
- Sales status
- Source version
- Import manifest
- Import readiness status

### Optional Fields

- Project code
- Address
- Short description
- Full description
- Construction status
- Completion date
- Ownership type
- Distance to beach
- Distance to airport
- Latitude / longitude
- Main image
- Brochure URL
- Starting price
- Price range
- Verified price label
- Last price update
- Last inspection date
- Trust note
- Market position
- Verdict
- Highlights

## 2. Developer

Developer data identifies the organization responsible for the project.

### Required Fields

- Developer name
- Developer slug
- Country

### Optional Fields

- Legal name
- Description
- Website
- Logo
- Headquarters location
- Contact name
- Contact phone
- Contact email
- Verification status
- Last verified date
- Notes

## 3. Location

Location data standardizes project geography and market context.

### Required Fields

- Location slug
- Area name
- Country
- Province

### Optional Fields

- District
- Latitude
- Longitude
- Description
- Market summary
- Lifestyle summary
- Nearby schools
- Nearby hospitals
- Distance to beach
- Distance to airport

## 4. Building

Buildings represent physical project structures within a project.

### Required Fields

- Project ID
- Building name
- Building code

### Optional Fields

- Building type
- Floors count
- Units count
- Construction status
- Completion date
- Sort order
- Source metadata

## 5. Unit

Units represent individual saleable or referenceable inventory records.

### Required Fields

- Project ID
- Unit code / room number
- Unit type
- Availability status

### Optional Fields

- Building ID
- Developer type code
- Bedrooms
- Bathrooms
- Size in square meters
- Floor
- View type
- Ownership type
- Base price in THB
- Discounted price in THB
- Price per square meter
- Payment plan
- Furniture package
- Rental guarantee
- ROI estimate
- Notes
- Source metadata

## 6. Price History

Price History records preserve pricing evidence over time.

### Required Fields

- Unit ID
- Price
- Currency
- Price source
- Recorded date

### Optional Fields

- Source file
- Source page
- Price list date
- Metadata with raw extracted values

### Standard Values

- Default project currency for Phuket imports: THB unless source data proves otherwise.
- Developer price list source label: `developer_price_list`.
- Price list dates must be normalized to ISO format: `YYYY-MM-DD`.

## 7. Documents

Documents store project evidence and official source material.

### Required Fields

- Project ID
- Document type
- Title
- Source file or URL

### Optional Fields

- Description
- File extension
- File size
- Source date
- Verification status
- Public/private visibility
- Metadata

### Common Document Types

- Brochure
- Price list
- Unit plan
- Floor plan
- Master plan
- Legal document
- Construction permit
- EIA approval
- Furniture package

## 8. Media

Media includes visual and video assets used across Forever interfaces.

### Required Fields

- Project ID
- Media type
- Title or file name
- Source file or URL

### Optional Fields

- Alt text
- Caption
- Sort order
- Width
- Height
- Duration
- Thumbnail
- Public/private visibility
- Metadata

### Media Types

- Image
- Video
- Gallery image
- Perspective image
- Show unit photo
- Map image
- Floor plan image
- Master plan image

## 9. Intelligence

Intelligence data stores deterministic evaluation outputs and source-backed signals.

### Required Fields

- Project ID
- Intelligence version
- Overall recommendation
- Forever Score
- Forever Verdict
- Confidence
- Source fields
- Source values

### Optional Fields

- Strengths
- Weaknesses
- Risks
- Best Buyer Profile
- Rental Strategy
- Exit Strategy
- Investment Horizon
- Trust score
- Investment score
- Rental score
- Location score
- Liquidity score
- Construction risk score

### Rule

Every intelligence output must be traceable to structured project data. No recommendation may depend on unstored assumptions.

## 10. Passport

The Forever Passport is the canonical project summary used across interfaces.

### Required Fields

- Forever ID
- Project name
- Overall score
- Verdict
- Trust
- Investment
- Rental
- Liquidity
- Construction
- Best Buyer Profile
- Recommendation summary
- Risks summary
- Verification dates

### Optional Fields

- Last inspection date
- Last price update
- QR verification placeholder
- Digital certificate reference
- Timeline
- Source metadata

### Rule

Every project must have one canonical digital passport used across all Forever interfaces.

## 11. Validation Rules

Validation must happen before import.

Required validation:

- Manifest exists.
- Manifest version is supported.
- Required source folders exist.
- Required source folders contain supported files.
- `import-status.json` exists.
- Required assets are available.
- Extracted JSON files parse successfully.
- Unit rows have required fields.
- Numeric fields parse cleanly.
- No duplicate unit codes.
- No duplicate price-history source keys.
- No orphan building, unit, or price-history records.
- Missing facts remain null.

Import validation:

- Dry-run must pass before real import.
- Real import must be idempotent.
- Running the same import twice must not create duplicates.
- Counts must remain stable after idempotency testing.

## 12. Gold Standard Requirements

A Forever Gold Standard project must include:

- Valid manifest.
- Passing import-status.
- Brochure extraction.
- Price-list extraction.
- Developer record.
- Location record.
- Project record.
- Building records.
- Unit inventory.
- Price history.
- Legal or verification documents where available.
- Media classified into standard folders.
- Forever Passport.
- Forever Intelligence report.
- Source-backed validation report.
- No duplicate units.
- No duplicate price-history records.

## 13. Data Completeness Formula

Forever project completeness is measured as:

```text
Data Completeness =
  Required Core Fields Score
+ Source Evidence Score
+ Inventory Completeness Score
+ Pricing Completeness Score
+ Verification Completeness Score
+ Intelligence Readiness Score
```

Recommended weighting:

- Required Core Fields: 25%
- Source Evidence: 20%
- Inventory Completeness: 20%
- Pricing Completeness: 15%
- Verification Completeness: 10%
- Intelligence Readiness: 10%

Completeness levels:

- 90-100%: Gold Standard
- 75-89%: Import Ready
- 50-74%: Review Required
- Below 50%: Not Ready

## 14. Future Extensions

Future versions may add:

- Multi-currency pricing.
- Historical availability tracking.
- Building-level construction progress.
- Unit-level media.
- Document OCR confidence scoring.
- Geospatial scoring.
- CRM buyer-fit records.
- Tablet Booth Mode presentation metadata.
- PDF investor report templates.
- Mobile app sync metadata.
- Knowledge Engine source graph.
- Full audit trail for every imported fact.
