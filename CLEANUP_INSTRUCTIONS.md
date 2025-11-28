# Home Data Cleanup Instructions

## Background

After removing the section-related fields from the Home schema (sectionTitle, sectionSubtitle, sectionText, sectionItems), existing documents in the database still contain these legacy fields. This cleanup process removes them to ensure clean API responses.

## Automatic Cleanup

The API now automatically filters out legacy fields in responses using `.select()` in MongoDB queries. However, you may want to permanently remove these fields from the database.

## Manual Cleanup Options

### Option 1: API Endpoint (Recommended)

Use the cleanup endpoint to remove legacy fields from all home documents:

```bash
# POST request to cleanup endpoint (requires admin authentication)
curl -X POST http://localhost:5001/api/home/cleanup \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### Option 2: Direct Script Execution

Run the cleanup script directly:

```bash
cd backend
node src/utils/cleanHomeData.js
```

### Option 3: MongoDB Shell

Connect to MongoDB directly and run:

```javascript
db.homes.updateMany(
  {},
  {
    $unset: {
      sectionTitle: "",
      sectionSubtitle: "",
      sectionText: "",
      sectionItems: "",
    },
  }
);
```

## Verification

After cleanup, verify that the `/api/home` endpoint returns only the expected fields:

- `_id`
- `title`
- `text`
- `video`
- `slug`
- `createdAt`
- `updatedAt`

Legacy fields (sectionTitle, sectionSubtitle, sectionText, sectionItems) should no longer appear in the response.
