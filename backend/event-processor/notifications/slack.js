import axios from 'axios'

async function sendSlackNotification(eventData, analysis) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('⚠️  Slack webhook not configured, skipping notification');
    return;
  }
  
  try {
    console.log('Sending Slack notification...');
    
    const sentimentEmoji = !eventData.sentiment ? '➡️' :
                          eventData.sentiment > 0.2 ? '📈' : 
                          eventData.sentiment < -0.2 ? '📉' : '➡️';
    
    const confidenceEmoji = analysis.confidence_level === 'HIGH' ? '🟢' :
                           analysis.confidence_level === 'MEDIUM' ? '🟡' : '🔴';
    
    const message = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 New ${eventData.eventType} Event Detected`,
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Ticker:*\n${eventData.ticker}`
            },
            {
              type: 'mrkdwn',
              text: `*Sentiment:*\n${sentimentEmoji} ${eventData.sentiment ? eventData.sentiment.toFixed(2) : 'N/A'}`
            },
            {
              type: 'mrkdwn',
              text: `*Confidence:*\n${confidenceEmoji} ${analysis.confidence_level}`
            },
            {
              type: 'mrkdwn',
              text: `*Time:*\n<!date^${Math.floor(new Date(eventData.timestamp).getTime() / 1000)}^{date_short_pretty} {time}|${eventData.timestamp}>`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Headline:*\n${eventData.headline}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Summary:*\n${analysis.summary}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Top Insights:*\n${analysis.key_insights.slice(0, 3).map(i => `• ${i}`).join('\n')}`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View Full Analysis',
                emoji: true
              },
              url: `${process.env.DASHBOARD_URL || 'http://localhost:3000'}/event/${eventData.eventId}`,
              style: 'primary'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Source',
                emoji: true
              },
              url: eventData.url
            }
          ]
        }
      ]
    };
    
    await axios.post(webhookUrl, message);
    console.log('✅ Slack notification sent');
  } catch (error) {
    console.error('Error sending Slack notification:', error.message);
    // Don't throw - notifications are nice to have but not critical
  }
}

export { sendSlackNotification }; 