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
                model: 'claude-3-sonnet-20240229',
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

// Web search endpoint for resources
app.post('/api/search-resources', async (req, res) => {
    try {
        const { concerningAreas, location = 'Oregon' } = req.body;
        
        // For MVP, return curated resources
        // In production, could integrate with real search APIs
        const resources = generateResourcesForAreas(concerningAreas, location);
        
        res.json({ 
            success: true, 
            resources 
        });
        
    } catch (error) {
        console.error('Error searching resources:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to search resources' 
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

function generateResourcesForAreas(concerningAreas, location) {
    const resourceDatabase = {
        financial: [
            {
                title: "💰 Oregon Employment Department", 
                description: "File for unemployment benefits and access job search resources",
                url: "https://www.oregon.gov/employ/"
            },
            {
                title: "🏦 211info Financial Assistance",
                description: "Connect with local emergency financial assistance programs", 
                url: "https://www.211info.org"
            },
            {
                title: "💳 SNAP Benefits Oregon",
                description: "Apply for food assistance and nutrition support",
                url: "https://www.oregon.gov/dhs/assistance/food-benefits/"
            }
        ],
        occupational: [
            {
                title: "💼 WorkSource Oregon",
                description: "Free career counseling, resume help, and job placement services",
                url: "https://www.worksourceoregon.org"
            },
            {
                title: "🌐 Oregon Career Information System",
                description: "Career exploration tools and job market data",
                url: "https://www.oregoncis.uoregon.edu"
            },
            {
                title: "🎓 Portland Community College",
                description: "Job training programs and career development courses",
                url: "https://www.pcc.edu"
            }
        ],
        emotional: [
            {
                title: "🆘 Oregon Crisis & Suicide Lifeline",
                description: "Call 988 for immediate crisis support, available 24/7",
                url: "https://www.oregon.gov/oha/ph/preventionwellness/suicideprevention/"
            },
            {
                title: "🧠 NAMI Oregon",
                description: "Mental health support groups and educational resources",
                url: "https://namior.org"
            },
            {
                title: "💬 Crisis Text Line",
                description: "Text HOME to 741741 for crisis counseling via text",
                url: "https://www.crisistextline.org"
            }
        ],
        physical: [
            {
                title: "🏥 Oregon Health Authority",
                description: "Find community health centers and healthcare resources",
                url: "https://www.oregon.gov/oha/"
            },
            {
                title: "🩺 Federally Qualified Health Centers",
                description: "Low-cost healthcare regardless of insurance status",
                url: "https://findahealthcenter.hrsa.gov/"
            }
        ],
        social: [
            {
                title: "👥 AA Meetings Oregon",
                description: "Find local Alcoholics Anonymous meetings and support groups",
                url: "https://www.aa.org"
            },
            {
                title: "🤝 NA Meetings Oregon", 
                description: "Narcotics Anonymous meetings and recovery community",
                url: "https://www.na.org"
            },
            {
                title: "🌟 SMART Recovery",
                description: "Alternative recovery support meetings and tools",
                url: "https://www.smartrecovery.org"
            }
        ],
        environmental: [
            {
                title: "🏠 Oregon Housing Authority",
                description: "Housing assistance and emergency shelter resources",
                url: "https://www.oregon.gov/ohcs/"
            },
            {
                title: "🆘 211info Housing Help",
                description: "Emergency housing assistance and rental support",
                url: "https://www.211info.org"
            }
        ],
        intellectual: [
            {
                title: "📚 Multnomah County Library",
                description: "Free educational resources, computer access, and classes",
                url: "https://multcolib.org"
            },
            {
                title: "🎓 Oregon Adult Education",
                description: "GED classes and adult learning programs",
                url: "https://www.oregon.gov/ode/students-and-family/AdultEd/"
            }
        ],
        spiritual: [
            {
                title: "⛪ Recovery-Friendly Faith Communities",
                description: "Find supportive religious and spiritual communities",
                url: "https://www.oregon.gov/oha/hsd/amh/pages/recovery-support.aspx"
            },
            {
                title: "🧘 Mindfulness-Based Recovery",
                description: "Meditation and spiritual wellness resources",
                url: "https://mindfulnessbasedaddictionrecovery.com"
            }
        ]
    };
    
    let resources = [];
    concerningAreas.forEach(area => {
        if (resourceDatabase[area]) {
            resources.push(...resourceDatabase[area]);
        }
    });
    
    // Add general resources if none found
    if (resources.length === 0) {
        resources = [
            {
                title: "📞 211info Oregon",
                description: "Dial 2-1-1 for help finding any local resources", 
                url: "https://www.211info.org"
            },
            {
                title: "🌟 Oregon Recovers",
                description: "Statewide recovery support and advocacy",
                url: "https://www.oregonrecovers.org"
            }
        ];
    }
    
    return resources.slice(0, 4); // Limit to 4 resources
}

app.listen(PORT, () => {
    console.log(`WellCheck server running on port ${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
});
