import axios from 'axios';

/**
 * Build webhook-to-users mapping with deduplication
 *
 * @param {Map<userId, {webhook_url}>} userSettings - Map of user settings
 * @param {string} defaultWebhook - Fallback webhook URL from env
 * @returns {Map<webhookUrl, Set<userId>>} Map of webhook URL to users
 */
function buildWebhookMapping(userSettings, defaultWebhook) {
  const webhookToUsers = new Map();

  for (const [userId, settings] of userSettings.entries()) {
    const webhookUrl = settings.webhook_url || defaultWebhook;

    if (!webhookUrl) {
      console.log(`⚠️  No webhook configured for user ${userId} and no default webhook - skipping`);
      continue;
    }

    if (!webhookToUsers.has(webhookUrl)) {
      webhookToUsers.set(webhookUrl, new Set());
    }
    webhookToUsers.get(webhookUrl).add(userId);
  }

  return webhookToUsers;
}

/**
 * Build Slack message blocks
 */
function buildSlackMessage(eventData, analysis, userCount) {
  const sentimentEmoji = !eventData.sentiment ? '➡️' :
                        eventData.sentiment > 0.2 ? '📈' :
                        eventData.sentiment < -0.2 ? '📉' : '➡️';

  const confidenceEmoji = analysis.confidence_level === 'HIGH' ? '🟢' :
                         analysis.confidence_level === 'MEDIUM' ? '🟡' : '🔴';

  return {
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
      },
      // Add context showing how many users watching (only if > 1)
      ...(userCount > 1 ? [{
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_${userCount} users watching this ticker_`
          }
        ]
      }] : [])
    ]
  };
}

/**
 * Send Slack notification to a specific webhook
 */
async function sendToWebhook(webhookUrl, message) {
  try {
    await axios.post(webhookUrl, message, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return { success: true };
  } catch (error) {
    console.error(`Error sending to webhook ${webhookUrl.substring(0, 50)}...:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send Slack notifications to all unique user webhooks
 *
 * @param {Object} eventData - Event data from SNS
 * @param {Object} analysis - AI analysis results
 * @param {Map<userId, {webhook_url}>} userSettings - User settings from DynamoDB
 */
async function sendSlackNotification(eventData, analysis, userSettings) {
  const defaultWebhook = process.env.SLACK_WEBHOOK_URL;

  if (!userSettings || userSettings.size === 0) {
    // Fallback to original behavior if no user settings
    console.log('⚠️  No user settings provided, using default webhook behavior');
    if (!defaultWebhook) {
      console.log('⚠️  No default webhook configured, skipping notification');
      return;
    }

    const message = buildSlackMessage(eventData, analysis, 1);
    const result = await sendToWebhook(defaultWebhook, message);

    if (result.success) {
      console.log('✅ Notification sent to default webhook');
    }
    return;
  }

  console.log(`\n--- Sending Slack Notifications ---`);
  console.log(`Processing notifications for ${userSettings.size} users`);

  // Build webhook-to-users mapping (deduplication)
  const webhookToUsers = buildWebhookMapping(userSettings, defaultWebhook);

  console.log(`Deduplicated to ${webhookToUsers.size} unique webhook(s)`);

  // Send to each unique webhook
  const results = [];
  for (const [webhookUrl, users] of webhookToUsers.entries()) {
    console.log(`Sending to webhook for ${users.size} user(s): ${Array.from(users).join(', ')}`);

    const message = buildSlackMessage(eventData, analysis, users.size);
    const result = await sendToWebhook(webhookUrl, message);

    results.push({
      webhook: webhookUrl.substring(0, 50) + '...',
      userCount: users.size,
      success: result.success
    });

    if (result.success) {
      console.log(`✅ Notification sent (${users.size} user(s))`);
    } else {
      console.log(`❌ Notification failed: ${result.error}`);
    }
  }

  // Summary
  const successCount = results.filter(r => r.success).length;
  const totalUserCount = Array.from(webhookToUsers.values()).reduce((sum, users) => sum + users.size, 0);

  console.log(`\nNotification Summary:`);
  console.log(`- Total users: ${userSettings.size}`);
  console.log(`- Unique webhooks: ${webhookToUsers.size}`);
  console.log(`- Successful: ${successCount}/${webhookToUsers.size}`);
  console.log(`- Users notified: ${successCount > 0 ? totalUserCount : 0}`);
}

export { sendSlackNotification };
