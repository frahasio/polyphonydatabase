# How to Upload Your Saved Data

## Step 1: Clean the JSON
Remove all `null` values from the inclusions array. There are 3 nulls at positions 39, 69, and 90.

## Step 2: Open Browser Console
1. Go to: https://polyphonydatabase.com/modules/sources/edit.html?id=10054
2. Make sure you're logged in
3. Press F12 (or right-click → Inspect → Console tab)

## Step 3: Paste and Run This Code

Replace `YOUR_CLEANED_JSON_HERE` with your cleaned JSON payload:

```javascript
const payload = YOUR_CLEANED_JSON_HERE; // Paste your cleaned JSON here

async function uploadData() {
    const sourceId = 10054;
    
    try {
        console.log('Starting upload...');
        const response = await fetch(`/api/admin/sources/${sourceId}/save-with-inclusions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Upload failed:', errorData);
            alert('Upload failed: ' + (errorData.details || errorData.error));
        } else {
            const result = await response.json();
            console.log('Upload successful!', result);
            alert('Upload successful! ' + result.message);
            window.location.reload();
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload error: ' + error.message);
    }
}

uploadData();
```

## Alternative: Quick Clean Script

If you want to clean the JSON automatically, paste this first:

```javascript
// Clean your JSON payload
const rawPayload = YOUR_RAW_JSON_HERE; // Your original JSON with nulls

// Remove null inclusions
rawPayload.inclusions = rawPayload.inclusions.filter(inc => inc !== null);

console.log('Cleaned payload:', rawPayload);
console.log('Original count:', rawPayload.inclusions.length + 3, '→ Cleaned count:', rawPayload.inclusions.length);

// Then use the upload script above with rawPayload instead of payload
```



