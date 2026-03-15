// ============================================
// UPLOAD SCRIPT - Paste this in browser console
// ============================================
// 1. Go to: https://polyphonydatabase.com/modules/sources/edit.html?id=10054
// 2. Open browser console (F12)
// 3. Paste your JSON payload below (replace the empty object)
// 4. Paste this entire script and run it

const rawPayload = {
    // PASTE YOUR ENTIRE JSON PAYLOAD HERE (the one you saved)
    // Just copy-paste the whole thing starting with { "source": { ...
};

// Step 1: Clean null values from inclusions
if (rawPayload.inclusions) {
    const originalCount = rawPayload.inclusions.length;
    rawPayload.inclusions = rawPayload.inclusions.filter(inc => inc !== null);
    console.log(`Cleaned ${originalCount - rawPayload.inclusions.length} null entries`);
    console.log(`Processing ${rawPayload.inclusions.length} inclusions`);
}

// Step 2: Upload to server
async function uploadData() {
    const sourceId = 10054; // Your source ID
    
    try {
        console.log('Starting upload...');
        console.log('Source:', rawPayload.source.code);
        console.log('Inclusions to process:', rawPayload.inclusions.length);
        
        const response = await fetch(`/api/admin/sources/${sourceId}/save-with-inclusions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rawPayload)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Upload failed:', errorData);
            alert('Upload failed: ' + (errorData.details || errorData.error));
            return;
        }
        
        const result = await response.json();
        console.log('✅ Upload successful!', result);
        alert('✅ Upload successful!\n\n' + result.message);
        
        // Reload page after 2 seconds
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload error: ' + error.message);
    }
}

// Run the upload
uploadData();



