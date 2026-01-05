// Simple script to upload the saved JSON data
// Run this in the browser console on the edit page for source 10054

const payload = {
    "source": {
        "code": "GB-Lbl Add. 17792-17796",
        "title": "",
        "type": "MS",
        "format": "Partbook",
        "from_year_annotation": "",
        "from_year": null,
        "to_year_annotation": "after",
        "to_year": 1624,
        "town": "",
        "rism_link": "",
        "notes": "",
        "catalogued": false,
        "publishers": [],
        "scribes": [10],
        "source_images": []
    },
    "inclusions": [
        // Your inclusions array here - I'll provide the cleaned version
    ]
};

// Clean the inclusions array - remove null values
// (The actual inclusions data would go here - too long to include in this template)

async function uploadData() {
    const sourceId = 10054; // Your source ID
    
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
            // Optionally reload the page
            // window.location.reload();
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Upload error: ' + error.message);
    }
}

// uploadData(); // Uncomment to run

