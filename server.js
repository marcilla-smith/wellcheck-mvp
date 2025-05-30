// server.js - VYBIN Backend
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files

// Enhanced location detection endpoint
app.post('/api/detect-location', async (req, res) => {
    try {
        // Try to get user's location from IP - improved logic
        let userIP = req.headers['x-forwarded-for'] || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    req.socket.remoteAddress ||
                    (req.connection.socket ? req.connection.socket.remoteAddress : null);
        
        // Clean up IP address (handle potential multiple IPs in x-forwarded-for)
        if (userIP && userIP.includes(',')) {
            userIP = userIP.split(',')[0].trim();
        }
        
        // Remove IPv6 prefix if present
        if (userIP && userIP.startsWith('::ffff:')) {
            userIP = userIP.substring(7);
        }
        
        console.log('🌍 VYBIN: Detecting location for IP:', userIP);
        
        // For MVP, use a simple IP geolocation service with fallback
        if (userIP && userIP !== '::1' && !userIP.startsWith('127.') && !userIP.startsWith('192.168.') && !userIP.startsWith('10.')) {
            try {
                // Try multiple geolocation services for better accuracy
                let geoData = null;
                
                // Primary service
                try {
                    const geoResponse = await fetch(`http://ip-api.com/json/${userIP}?fields=status,country,regionName,city,lat,lon,isp`);
                    geoData = await geoResponse.json();
                    console.log('📍 Primary geolocation response:', geoData);
                } catch (primaryError) {
                    console.log('⚠️ Primary geolocation failed, trying backup...');
                    
                    // Backup service
                    const backupResponse = await fetch(`http://ipinfo.io/${userIP}/json`);
                    const backupData = await backupResponse.json();
                    if (backupData.city && backupData.region) {
                        geoData = {
                            status: 'success',
                            city: backupData.city,
                            regionName: backupData.region,
                            country: backupData.country
                        };
                        console.log('📍 Backup geolocation response:', geoData);
                    }
                }
                
                if (geoData && (geoData.status === 'success' || geoData.city)) {
                    res.json({ 
                        success: true, 
                        state: geoData.regionName || geoData.region,
                        city: geoData.city,
                        country: geoData.country,
                        latitude: geoData.lat,
                        longitude: geoData.lon,
                        detected: true,
                        ip: userIP,
                        isp: geoData.isp
                    });
                    return;
                }
            } catch (geoError) {
                console.error('🚫 All geolocation services failed:', geoError.message);
            }
        } else {
            console.log('🏠 Local/private IP detected:', userIP);
        }
        
        // Enhanced fallback - don't assume location
        console.log('🌐 Using enhanced location fallback');
        res.json({ 
            success: true, 
            state: 'Your State', 
            city: 'Your City',
            country: 'United States',
            detected: false,
            ip: userIP,
            note: 'Location detection unavailable for this IP'
        });
        
    } catch (error) {
        console.error('💥 VYBIN: Error detecting location:', error);
        res.json({ 
            success: false, 
            state: 'Your State', 
            city: 'Your City',
            error: error.message
        });
    }
});

// Preliminary insights endpoint (called before user adds context)
app.post('/api/preliminary-insights', async (req, res) => {
    try {
        const { ratings, userHistory } = req.body;
        
        console.log('🎯 VYBIN: Getting preliminary insights for ratings:', ratings);
        console.log('📚 User history received:', {
            totalCheckins: userHistory?.checkins?.length || 0,
            hasRecentContext: !!(userHistory?.checkins?.[userHistory.checkins.length - 1]?.context)
        });
        
        const prompt = createPreliminaryPrompt(ratings, userHistory);
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 400, // Shorter response for preliminary
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });
        
        if (!response.ok) {
            console.error('Claude API error:', response.status, await response.text());
            throw new Error(`Claude API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ VYBIN: Preliminary insights response received');
        
        res.json({ 
            success: true, 
            response: data.content[0].text 
        });
        
    } catch (error) {
        console.error('💥 VYBIN: Error getting preliminary insights:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get preliminary insights' 
        });
    }
});

// Extended conversation endpoint (with limits for MVP)
app.post('/api/continue-conversation', async (req, res) => {
    try {
        const { initialResponse, userQuestion, checkinData, conversationCount = 0 } = req.body;
        
        console.log('🤖 VYBIN: Continue conversation request:', {
            userQuestion: userQuestion,
            hasCheckinData: !!checkinData,
            conversationCount: conversationCount
        });
        
        // Enforce conversation limit for MVP
        if (conversationCount >= 2) {
            console.log('🚫 VYBIN: Conversation limit reached');
            return res.json({
                success: false,
                error: 'Conversation limit reached. Upgrade to premium for unlimited conversations.',
                requiresUpgrade: true
            });
        }
        
        const prompt = `You are continuing a VYBIN wellness conversation. Here's the context:

PREVIOUS CONVERSATION:
Initial wellness response: "${initialResponse}"
User's follow-up question: "${userQuestion}"

USER'S ORIGINAL CHECK-IN:
${JSON.stringify(checkinData, null, 2)}

CONVERSATION COUNT: ${conversationCount + 1}/2 (MVP limit)

Continue this conversation naturally. Do NOT restart or introduce yourself again. Respond directly to their follow-up question while referencing the context you already established.

Keep responses:
- Conversational and helpful
- Specific to their situation
- Brief (2-3 paragraphs max)
- Focused on practical guidance

Response:`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 800,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });
        
        if (!response.ok) {
            console.error('Claude API error in continue conversation:', response.status, await response.text());
            throw new Error(`Claude API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ VYBIN: Continue conversation response received');
        
        res.json({ 
            success: true, 
            response: data.content[0].text,
            conversationCount: conversationCount + 1
        });
        
    } catch (error) {
        console.error('💥 VYBIN: Error in extended conversation:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to continue conversation' 
        });
    }
});

// Claude API endpoint - Main wellness response (with conversation tracking)
app.post('/api/wellness-response', async (req, res) => {
    try {
        const { checkin, userHistory, preliminaryInsights, conversationCount = 0 } = req.body;
        
        console.log('🧠 VYBIN: Getting wellness response for checkin:', {
            hasRatings: !!checkin.ratings,
            ratingsCount: Object.keys(checkin.ratings || {}).length,
            hasContext: !!checkin.context,
            contextLength: checkin.context?.length || 0,
            date: checkin.dateOnly,
            userHistoryCheckins: userHistory?.checkins?.length || 0,
            preliminaryInsightsLength: preliminaryInsights?.length || 0,
            conversationCount: conversationCount
        });
        
        // CRITICAL: Log user history to identify data bleeding
        if (userHistory?.checkins?.length > 0) {
            console.log('📊 User history contexts:', userHistory.checkins.map(c => ({
                date: c.dateOnly,
                contextSnippet: c.context?.substring(0, 50) || 'no context'
            })));
        }
        
        const prompt = createWellnessPrompt(checkin, userHistory, preliminaryInsights);
        
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
            console.error('Claude API error in wellness response:', response.status, await response.text());
            throw new Error(`Claude API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ VYBIN: Wellness response received');
        
        res.json({ 
            success: true, 
            response: data.content[0].text 
        });
        
    } catch (error) {
        console.error('💥 VYBIN: Error calling Claude API:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get wellness response' 
        });
    }
});

// Web search endpoint for resources
app.post('/api/search-resources', async (req, res) => {
    try {
        const { concerningAreas, location, city, state, userContext, userRatings } = req.body;
        
        console.log('🔍 VYBIN: Searching resources for:', {
            location: location,
            concerningAreas: concerningAreas,
            hasUserContext: !!userContext,
            contextLength: userContext?.length || 0
        });
        
        // Create search queries for Claude to use
        const locationString = city && state ? `${city}, ${state}` : location || 'your area';
        
        // Use user's actual context to create more relevant searches
        let contextualSearchTerms = [];
        
        if (userContext && userContext.trim()) {
            // Extract key terms from user's context for more relevant searches
            const context = userContext.toLowerCase();
            
            // Look for specific situations mentioned
            if (context.includes('job') || context.includes('unemploy') || context.includes('work')) {
                contextualSearchTerms.push(`job search unemployment assistance ${locationString}`);
            }
            if (context.includes('money') || context.includes('financial') || context.includes('bills') || context.includes('rent')) {
                contextualSearchTerms.push(`emergency financial assistance rent help ${locationString}`);
            }
            if (context.includes('storm') || context.includes('weather') || context.includes('flood') || context.includes('emergency')) {
                contextualSearchTerms.push(`weather emergency assistance disaster relief ${locationString}`);
            }
            if (context.includes('housing') || context.includes('homeless') || context.includes('evict')) {
                contextualSearchTerms.push(`housing assistance emergency shelter ${locationString}`);
            }
            if (context.includes('health') || context.includes('medical') || context.includes('doctor') || context.includes('weight') || context.includes('fat')) {
                contextualSearchTerms.push(`weight loss programs medical weight management ${locationString}`);
            }
            if (context.includes('stress') || context.includes('anxiety') || context.includes('depress')) {
                contextualSearchTerms.push(`mental health counseling support groups ${locationString}`);
            }
            if (context.includes('rabbi') || context.includes('church') || context.includes('spiritual') || context.includes('faith')) {
                contextualSearchTerms.push(`spiritual counseling faith community support ${locationString}`);
            }
        }
        
        // If no contextual terms found, fall back to dimension-based searches
        if (contextualSearchTerms.length === 0) {
            contextualSearchTerms = concerningAreas.map(area => {
                switch(area) {
                    case 'financial': 
                        return `financial assistance emergency aid ${locationString}`;
                    case 'occupational': 
                        return `job search career services ${locationString}`;
                    case 'emotional': 
                        return `mental health support counseling ${locationString}`;
                    case 'physical': 
                        return `healthcare community health centers ${locationString}`;
                    case 'social': 
                        return `support groups community resources ${locationString}`;
                    case 'environmental': 
                        return `housing assistance emergency shelter ${locationString}`;
                    case 'intellectual': 
                        return `adult education learning resources ${locationString}`;
                    case 'spiritual': 
                        return `spiritual wellness community support ${locationString}`;
                    default: 
                        return `wellness resources ${locationString}`;
                }
            });
        }
        
        // Use Claude to search and format resources with user's specific context
        const prompt = `You are a helpful resource finder for VYBIN wellness app users. I need you to search for and provide specific, actionable resources for someone dealing with these specific concerns.

Location: ${locationString}

What they told me: "${userContext || 'General wellness concerns'}"

Areas they rated low (1-2/5): ${concerningAreas.join(', ')}

Based on what they specifically shared with you, find 3-4 relevant resources that would actually help someone in ${locationString} with their specific situation.

Focus on resources that connect to what they actually told you, not just generic categories.

Format your response as a JSON array like this:
[
  {
    "title": "📞 Specific Organization Name", 
    "description": "Brief description connecting to their specific situation",
    "url": "actual website URL"
  }
]

Prioritize:
- Resources that address their specific context/situation
- Local government services and 211 services
- Crisis support if they mentioned urgent situations
- Practical, actionable resources they can use immediately
- National resources with local chapters

Keep descriptions brief and specific to their situation.`;

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
            console.error('Claude API error in resource search:', response.status, await response.text());
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
            // Fallback to basic local resources
            resources = [
                {
                    title: "📞 211 Information & Referral",
                    description: `Call 2-1-1 for local help in ${locationString} with your specific situation`,
                    url: "https://www.211.org"
                },
                {
                    title: "🆘 988 Crisis Support",
                    description: "Call or text 988 for mental health crisis support",
                    url: "https://988lifeline.org"
                }
            ];
        }
        
        console.log('✅ VYBIN: Found resources:', resources.length);
        
        res.json({ 
            success: true, 
            resources: resources.slice(0, 4) // Limit to 4
        });
        
    } catch (error) {
        console.error('💥 VYBIN: Error searching resources:', error);
        
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

// Function to create preliminary prompt - ENHANCED VERSION
function createPreliminaryPrompt(ratings, userHistory = {}) {
    const dimensionNames = {
        physical: 'physical health',
        financial: 'financial situation', 
        emotional: 'emotional well-being',
        environmental: 'living environment',
        social: 'relationships',
        occupational: 'work/career',
        intellectual: 'mental stimulation',
        spiritual: 'spiritual well-being'
    };
    
    const ratedDimensions = Object.entries(ratings);
    const concerns = ratedDimensions.filter(([dim, rating]) => rating <= 2);
    const strengths = ratedDimensions.filter(([dim, rating]) => rating >= 4);
    const ratedCount = ratedDimensions.length;
    
    // Check user history to avoid assumptions
    const recentCheckins = userHistory.checkins || [];
    const isFirstTimeUser = recentCheckins.length === 0;
    
    console.log('📝 VYBIN: Creating preliminary prompt:', {
        ratedCount,
        concernsCount: concerns.length,
        strengthsCount: strengths.length,
        isFirstTimeUser,
        totalPreviousCheckins: recentCheckins.length
    });
    
    let prompt = `You are a supportive VYBIN wellness companion. A user just completed their daily check-in, rating ${ratedCount} out of 8 wellness dimensions.

THEIR RATINGS:
${ratedDimensions.map(([dim, rating]) => `${dimensionNames[dim]}: ${rating}/5`).join('\n')}

USER CONTEXT:
${isFirstTimeUser ? 
  'This is their FIRST time using VYBIN - you have NO previous knowledge about them.' :
  `They have ${recentCheckins.length} previous check-ins. You may acknowledge patterns but focus on today's ratings.`}

CRITICAL INSTRUCTIONS:
- Acknowledge what you notice from their ratings in a warm, personalized way
- Be specific about both challenges AND strengths you see
- ${isFirstTimeUser ? 'CRITICAL: Do NOT make ANY assumptions about why they rated things low - you know NOTHING about their background, work, living situation, relationships, or circumstances. Only acknowledge the ratings themselves.' : 'You may reference previous patterns, but focus on today'}
- Simply acknowledge the ratings without assuming causes, conditions, or situations
- Do NOT infer work problems, relationship issues, or life circumstances from ratings alone
- Keep it brief (2-3 sentences max)  
- Sound like a caring friend who's paying attention to what they told you
- Do NOT ask questions yet - just acknowledge what you see
- End with expressing interest in learning more about their situation

TONE: Warm, attentive, specific to their actual ratings, but don't assume causes

Response:`;

    return prompt;
}

// Main wellness prompt function - ENHANCED FOR DATA ISOLATION
function createWellnessPrompt(checkin, userHistory = {}, preliminaryInsights = '') {
    const { ratings, context } = checkin;
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
    
    // Create ratings summary
    const ratedDimensions = Object.entries(ratings);
    const concerns = ratedDimensions.filter(([dim, rating]) => rating <= 2);
    const strengths = ratedDimensions.filter(([dim, rating]) => rating >= 4);
    const recentCheckins = userHistory.checkins?.slice(-7) || [];
    
    // CRITICAL: Check if this user has any prior checkins to avoid data bleeding
    const isFirstTimeUser = !recentCheckins || recentCheckins.length === 0;
    const todayCheckins = recentCheckins.filter(c => c.dateOnly === checkin.dateOnly);
    const isFirstCheckinToday = todayCheckins.length <= 1;
    
    console.log('🧠 VYBIN: Creating wellness prompt:', {
        hasContext: !!context,
        contextLength: context?.length || 0,
        isFirstTimeUser,
        isFirstCheckinToday,
        totalCheckins: recentCheckins.length,
        todayCheckins: todayCheckins.length
    });
    
    let prompt = `You are a VYBIN wellness companion continuing a conversation. You already gave preliminary insights, now provide deeper support.

CONTEXT: You already acknowledged their ratings and said: "${preliminaryInsights}"

TODAY'S SPECIFIC SITUATION:
What they told you: "${context || 'No additional details provided'}"

Ratings given: ${ratedDimensions.map(([dim, rating]) => `${dimensionNames[dim]}: ${rating}/5`).join(', ')}
${concerns.length > 0 ? `Areas needing support: ${concerns.map(([dim, rating]) => dimensionNames[dim]).join(', ')}` : ''}

USER HISTORY CONTEXT:
${isFirstTimeUser ? 'This is their first time using VYBIN.' : 
  isFirstCheckinToday ? `This is their first check-in today. They have ${recentCheckins.length} total previous check-ins.` :
  `This is check-in #${todayCheckins.length} today. They have ${recentCheckins.length} total check-ins.`}

CRITICAL RESPONSE REQUIREMENTS:
- Do NOT say "hello" or introduce yourself again
- Do NOT repeat observations you already made in preliminary insights  
- Respond specifically to what they shared about their situation TODAY
- ${isFirstTimeUser ? 'CRITICAL: Do NOT make ANY assumptions about their work, relationships, living situation, or circumstances. You know NOTHING about their background except what they explicitly told you today.' : 'You may reference patterns from their previous check-ins, but focus on today'}
- ONLY reference circumstances they explicitly shared - do not infer or assume anything
- If they didn't mention work problems, don't assume work problems exist
- If they didn't mention relationship issues, don't assume relationship issues exist  
- Base your response ONLY on what they actually told you
- Provide practical, relevant guidance for their actual current situation
- Be conversational and supportive, not clinical or generic

LENGTH: 2 paragraphs maximum
TONE: Supportive friend who's been listening to today's conversation

Response:`;

    return prompt;
}

app.listen(PORT, () => {
    console.log(`🚀 VYBIN server running on port ${PORT}`);
    console.log(`💻 Frontend available at http://localhost:${PORT}`);
    console.log(`🎯 Ready to help users VYBIN with their wellness!`);
    console.log(`📊 MVP Features: 2-conversation limit, voice chat enabled`);
});