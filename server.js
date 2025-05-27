// server.js - WellCheck Backend
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// Claude API endpoint
app.post('/api/wellness-response', async (req, res) => {
    try {
        const { checkin, userHistory } = req.body;
        const prompt = createWellnessPrompt(checkin, userHistory);
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });
        
        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status}`);
        }
        
        const data = await response.json();
        res.json({ 
            success: true, 
            response: data.content[0].text 
        });
        
    } catch (error) {
        console.error('Error calling Claude API:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get wellness response' 
        });
    }
});

// Location detection endpoint
app.post('/api/detect-location', async (req, res) => {
    try {
        // Try to get user's location from IP
        let userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        // Clean up IP address (handle potential multiple IPs in x-forwarded-for)
        if (userIP && userIP.includes(',')) {
            userIP = userIP.split(',')[0].trim();
        }
        
        console.log('Detecting location for IP:', userIP);
        
        // For MVP, use a simple IP geolocation service
        if (userIP && userIP !== '::1' && !userIP.startsWith('127.') && !userIP.startsWith('::ffff:127.')) {
            try {
                const geoResponse = await fetch(`http://ip-api.com/json/${userIP}?fields=status,country,regionName,city,lat,lon`);
                const geoData = await geoResponse.json();
                
                console.log('Geolocation response:', geoData);
                
                if (geoData.status === 'success') {
                    res.json({ 
                        success: true, 
                        state: geoData.regionName,
                        city: geoData.city,
                        country: geoData.country,
                        latitude: geoData.lat,
                        longitude: geoData.lon,
                        detected: true,
                        ip: userIP
                    });
                    return;
                }
            } catch (geoError) {
                console.error('IP geolocation failed:', geoError);
            }
        }
        
        // Default fallback - but don't assume Washington anymore
        console.log('Using location fallback');
        res.json({ 
            success: true, 
            state: 'United States', 
            city: 'Your Area',
            country: 'United States',
            detected: false,
            ip: userIP
        });
        
    } catch (error) {
        console.error('Error detecting location:', error);
        res.json({ 
            success: false, 
            state: 'United States', 
            city: 'Your Area',
            error: error.message
        });
    }
});

// Web search endpoint for resources
app.post('/api/search-resources', async (req, res) => {
    try {
        const { concerningAreas, location, city, state } = req.body;
        
        // Create search queries for Claude to use
        const locationString = city && state ? `${city}, ${state}` : location || 'your area';
        
        const searchQueries = concerningAreas.map(area => {
            switch(area) {
                case 'financial': 
                    return `financial assistance programs ${locationString}`;
                case 'occupational': 
                    return `job search career services ${locationString}`;
                case 'emotional': 
                    return `mental health crisis support ${locationString}`;
                case 'physical': 
                    return `healthcare community health centers ${locationString}`;
                case 'social': 
                    return `support groups community resources ${locationString}`;
                case 'environmental': 
                    return `housing assistance ${locationString}`;
                case 'intellectual': 
                    return `adult education resources ${locationString}`;
                case 'spiritual': 
                    return `spiritual wellness resources ${locationString}`;
                default: 
                    return `wellness resources ${locationString}`;
            }
        });
        
        // Use Claude to search and format resources
        const prompt = `You are a helpful resource finder. I need you to search for and provide specific, actionable resources for someone dealing with these concerns: ${concerningAreas.join(', ')}.

Location: ${locationString}

For each concerning area, find 1-2 specific resources (websites, phone numbers, local organizations) that would actually help someone in ${locationString}.

Format your response as a JSON array of resources like this:
[
  {
    "title": "📞 Specific Organization Name",
    "description": "Brief description of what they offer",
    "url": "actual website URL"
  }
]

Focus on:
- Government services (unemployment, health departments, etc.)
- 211 services for the area
- Crisis lines (988, local crisis centers)
- Local nonprofits and community organizations
- National resources with local chapters

Keep descriptions brief and actionable. Limit to 4 resources total.`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });
        
        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status}`);
        }
        
        const data = await response.json();
        let resources;
        
        try {
            // Try to parse Claude's JSON response
            const resourceText = data.content[0].text;
            const jsonMatch = resourceText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                resources = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Error parsing Claude response:', parseError);
            // Fallback to basic national resources
            resources = [
                {
                    title: "📞 211 Information & Referral",
                    description: `Call 2-1-1 for local help in ${locationString}`,
                    url: "https://www.211.org"
                },
                {
                    title: "🆘 988 Crisis Lifeline",
                    description: "Call or text 988 for mental health crisis support",
                    url: "https://988lifeline.org"
                }
            ];
        }
        
        res.json({ 
            success: true, 
            resources: resources.slice(0, 4) // Limit to 4
        });
        
    } catch (error) {
        console.error('Error searching resources:', error);
        
        // Fallback resources
        res.json({ 
            success: true,
            resources: [
                {
                    title: "📞 211 Help Line",
                    description: "Call 2-1-1 for local assistance anywhere in the US",
                    url: "https://www.211.org"
                },
                {
                    title: "🆘 988 Crisis Support",
                    description: "Call or text 988 for mental health crisis help",
                    url: "https://988lifeline.org"
                }
            ]
        });
    }
});

function createWellnessPrompt(checkin, userHistory = {}) {
    const { ratings } = checkin;
    const dimensionNames = {
        physical: 'Physical',
        financial: 'Financial', 
        emotional: 'Emotional',
        environmental: 'Environmental',
        social: 'Social',
        occupational: 'Occupational',
        intellectual: 'Intellectual',
        spiritual: 'Spiritual'
    };
    
    // Find concerning areas (rated 1-2)
    const concerns = Object.entries(ratings)
        .filter(([dim, rating]) => rating <= 2)
        .map(([dim, rating]) => `${dimensionNames[dim]}: ${rating}/5`);
    
    // Get historical context
    const recentCheckins = userHistory.checkins?.slice(-7) || [];
    const hasHistory = recentCheckins.length > 1;
    
    let prompt = `You are a compassionate wellness companion for someone in recovery. Respond with empathy and understanding.

Today's wellness check-in:
${Object.entries(ratings).map(([dim, rating]) => `${dimensionNames[dim]}: ${rating}/5`).join('\n')}

${concerns.length > 0 ? `Areas of concern (rated 1-2): ${concerns.join(', ')}` : 'All dimensions rated 3 or higher - doing well overall!'}

${hasHistory ? `This person has been tracking for ${recentCheckins.length} days.` : 'This is a new user starting their wellness journey.'}

Guidelines:
- Be warm and supportive, never judgmental
- If there are concerning ratings (1-2), acknowledge them specifically  
- Offer encouragement for areas going well (4-5)
- Keep response conversational and brief (2-3 paragraphs max)
- Use recovery-friendly language (journey, progress, one day at a time)
- End with encouragement
- Be trauma-informed and avoid toxic positivity

Response:`;

    return prompt;
}

app.listen(PORT, () => {
    console.log(`WellCheck server running on port ${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
});