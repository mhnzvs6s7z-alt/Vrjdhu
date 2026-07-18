const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const discordTranscripts = require('discord-html-transcripts');

/* ================== [ Load Configuration ] ================== */
let config;
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    console.log('Config file loaded successfully');
} catch (err) {
    console.error('Failed to load config.json:', err.message);
    process.exit(1);
}

const TOKEN = config.token;
const CLIENT_ID = config.clientId;
const OWNER_ID = config.ownerId;
const TICKET_CATEGORY_ID = config.channels.ticketCategory;
const INQUIRE_CATEGORY_ID = config.channels.inquireCategory;
const COMPLAINT_CATEGORY_ID = config.channels.complaintCategory;
const PARTNERSHIP_CATEGORY_ID = config.channels.partnershipCategory;
const LOG_CHANNEL_ID = config.channels.logs;
const ADMIN_MENTION_ROLE_ID = config.roles.admin;
const SUPPORT_ROLE_ID = config.roles.support;

/* ================== [ Protection System ] ================== */

process.removeAllListeners('warning');

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Error Handling] Unhandled Rejection:', reason);
    sendErrorToLog('Unhandled Rejection (Critical)', reason?.stack || reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('[Error Handling] Uncaught Exception:', err);
    sendErrorToLog('Uncaught Exception (Critical)', err?.stack || err);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error('[Monitor] Continuous error detected:', err);
});

/* ================== [ Database ] ================== */
const DATA_FILE = path.join(__dirname, "tickets.json");
let data = { 
    counter: 0, 
    tickets: {}, 
    stats: { total: 0, open: 0, closed: 0 }, 
    apps_open: true,
    claimStats: {} // { "userId": { claims: 0, username: "name" } }
};

try {
    if (fs.existsSync(DATA_FILE)) {
        const loadedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        data = { ...data, ...loadedData };
        if (!data.claimStats) data.claimStats = {};
    }
} catch (err) {
    console.error("[Error] Failed to load database, creating new record:", err);
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[Error] Failed to save data:", err);
  }
}

/* ================== [ Slash Commands ] ================== */
const commands = [
    new SlashCommandBuilder().setName('add').setDescription('Add member to ticket').addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true)),
    new SlashCommandBuilder().setName('close').setDescription('Close current ticket'),
    new SlashCommandBuilder().setName('closeall').setDescription('Close all open tickets (Admin only)'),
    new SlashCommandBuilder().setName('transcript').setDescription('Export ticket transcript'),
    new SlashCommandBuilder().setName('setup').setDescription('Setup ticket system'),
    new SlashCommandBuilder().setName('refresh').setDescription('Refresh bot commands (Owner only)'),
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('Display top ticket claimers')
        .addIntegerOption(opt => 
            opt.setName('limit')
                .setDescription('Number of users to display (default: 10)')
                .setMinValue(1)
                .setMaxValue(25)
        ),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Change bot status (Owner only)')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Bot status type')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 Online', value: 'online' },
                    { name: '🟡 Idle', value: 'idle' },
                    { name: '🔴 Do Not Disturb', value: 'dnd' },
                    { name: '⚫ Invisible', value: 'invisible' }
                )
        ),
    new SlashCommandBuilder()
        .setName('dmall')
        .setDescription('Send DM to all open ticket owners (Admin only)')
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('Message to send')
                .setRequired(true)
        )
].map(command => command.toJSON());

/* ================== [ Logging Function ] ================== */
async function sendLog(title, description, color = "#2b2d31", fields = [], files = []) {
    try {
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .addFields(fields)
            .setTimestamp();

        await logChannel.send({ embeds: [embed], files: files });
    } catch (err) {
        console.error("[Log Error] Failed to send log:", err);
    }
}

async function sendErrorToLog(type, error) {
    try {
        await sendLog("Technical Error", `**Type:** ${type}\n**Message:** \`\`\`${error}\`\`\``, "#ff0000");
    } catch (e) {
        console.error("CRITICAL: Failed to send error to log channel.");
    }
}

/* ================== [ Bot Setup ] ================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});


client.once("clientReady", async () => {
  console.log(`=Run : ${client.user.tag}`);

  client.user.setPresence({
    status: "dnd"
  });
});

/* ========= [ Slash Commands Handler ] ========= */
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, channel, member } = interaction;

    try {
        if (commandName === 'add') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            if (!data.tickets[channel.id]) return interaction.reply({ content: "This command only works inside tickets.", flags: MessageFlags.Ephemeral });
            const user = options.getUser('user');
            await channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            await interaction.reply({ content: `Added ${user} to the ticket.` });
            await sendLog("👤 Member Added", `${user} was added to ${channel}`, "#5865f2");
        }

        if (commandName === 'close') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            if (!data.tickets[channel.id]) return interaction.reply({ content: "You can only close tickets.", flags: MessageFlags.Ephemeral });
            await interaction.reply("Closing and archiving ticket...");
            const attachment = await discordTranscripts.createTranscript(channel, { limit: -1, filename: `closed-${channel.name}.html` });
            await sendLog("🗑️ Ticket Closed", `**${channel.name}** was closed by ${interaction.user}`, "#ff0000", [], [attachment]);
            delete data.tickets[channel.id];
            saveData();
            setTimeout(() => channel.delete().catch(() => {}), 5000);
        }

        if (commandName === 'closeall') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply();

            const ticketChannelIds = Object.keys(data.tickets);
            
            if (ticketChannelIds.length === 0) {
                return interaction.editReply({ content: "No open tickets currently." });
            }

            let closedCount = 0;
            let failedCount = 0;

            await interaction.editReply({ content: `Closing ${ticketChannelIds.length} tickets... Please wait.` });

            for (const channelId of ticketChannelIds) {
                try {
                    const ticketChannel = await client.channels.fetch(channelId).catch(() => null);
                    
                    if (ticketChannel) {
                        const attachment = await discordTranscripts.createTranscript(ticketChannel, { 
                            limit: -1, 
                            filename: `closed-${ticketChannel.name}.html` 
                        }).catch(() => null);

                        if (attachment) {
                            await sendLog(
                                "🗑️ Mass Close", 
                                `**${ticketChannel.name}** was closed by ${interaction.user}`, 
                                "#ff0000", 
                                [], 
                                [attachment]
                            );
                        }

                        await ticketChannel.delete().catch(() => {});
                        closedCount++;
                    }
                    
                    delete data.tickets[channelId];
                    
                } catch (err) {
                    console.error(`Error closing ticket ${channelId}:`, err);
                    failedCount++;
                }
            }

            saveData();

            const resultEmbed = new EmbedBuilder()
                .setTitle("Mass Closure Completed")
                .setColor("#00ff00")
                .addFields(
                    { name: "Successfully Closed", value: `${closedCount}`, inline: true },
                    { name: "Failed", value: `${failedCount}`, inline: true },
                    { name: "Total", value: `${ticketChannelIds.length}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `By ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

            await interaction.editReply({ content: null, embeds: [resultEmbed] });

            await sendLog(
                "🗑️ Mass Close Complete", 
                `${interaction.user} closed **${closedCount}** tickets`, 
                "#ff0000"
            );
        }

        if (commandName === 'transcript') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply();
            const attachment = await discordTranscripts.createTranscript(channel, { limit: -1, filename: `transcript-${channel.name}.html` });
            await interaction.editReply({ content: "Transcript exported:", files: [attachment] });
        }

        if (commandName === 'setup') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            const setupEmbed = new EmbedBuilder()
                .setTitle("Ticket System Setup")
                .setDescription("Use `!tickets` to send the main control panel.")
                .setColor(config.appearance.color);
            await interaction.reply({ embeds: [setupEmbed], flags: MessageFlags.Ephemeral });
        }

        if (commandName === 'refresh') {
            // Check permissions: Support or Admin or Owner
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                                 interaction.user.id === OWNER_ID;
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const rest = new REST({ version: '10' }).setToken(TOKEN);

                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, interaction.guildId),
                    { body: [] }
                );

                await new Promise(resolve => setTimeout(resolve, 1000));

                const commandsData = commands.map(cmd => {
                    if (typeof cmd === 'string') return JSON.parse(cmd);
                    return cmd;
                });

                await rest.put(
                    Routes.applicationGuildCommands(CLIENT_ID, interaction.guildId),
                    { body: commandsData }
                );

                const refreshEmbed = new EmbedBuilder()
                    .setTitle("Bot Refreshed Successfully")
                    .setDescription("All commands and settings updated **instantly**!")
                    .addFields(
                        { name: "Commands Count", value: `${commandsData.length}`, inline: true },
                        { name: "Speed", value: "Instant", inline: true },
                        { name: "Responsible", value: `${interaction.user}`, inline: true }
                    )
                    .setColor("#00ff00")
                    .setTimestamp()
                    .setFooter({ text: "Refresh System • Commands available now" });
                
                
                

                await interaction.editReply({ embeds: [refreshEmbed] });

                await sendLog(
                    "🔄 Bot Refreshed", 
                    `Commands refreshed by ${interaction.user}`, 
                    "#00ff00"
                );

            } catch (error) {
                console.error('Error refreshing commands:', error);
                
                const errorEmbed = new EmbedBuilder()
                    .setTitle("Refresh Failed")
                    .setDescription(`An error occurred while refreshing the bot:\n\`\`\`${error.message}\`\`\``)
                    .setColor("#ff0000")
                    .setTimestamp();

                await interaction.editReply({ embeds: [errorEmbed] });
                await sendErrorToLog('Refresh Command Error', error.message);
            }
        }

        if (commandName === 'top') {
            // Check permissions: Support or Admin
            const hasPermission = member.roles.cache.has(SUPPORT_ROLE_ID) || 
                                 member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                return interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply();

            const limit = options.getInteger('limit') || 10;

            if (!data.claimStats || Object.keys(data.claimStats).length === 0) {
                return interaction.editReply({ content: "No statistics available. No tickets have been claimed yet." });
            }

            const sortedUsers = Object.entries(data.claimStats)
                .sort((a, b) => b[1].claims - a[1].claims)
                .slice(0, limit);

            let description = "";
            for (let i = 0; i < sortedUsers.length; i++) {
                const [userId, userData] = sortedUsers[i];
                const rank = i + 1;
                const user = await client.users.fetch(userId).catch(() => null);
                const mention = user ? `<@${userId}>` : userData.username || "Unknown user";
                
                description += `**#${rank}** ${mention} **${userData.claims}**\n`;
            }

            const topEmbed = new EmbedBuilder()
                .setTitle("Top Ticket Claimers")
                .setDescription(description)
                .setColor(config.appearance.color)
                .setTimestamp();

            await interaction.editReply({ embeds: [topEmbed] });
        }

        if (commandName === 'status') {
            if (interaction.user.id !== OWNER_ID) {
                return interaction.reply({ content: "This command is for owner only.", flags: MessageFlags.Ephemeral });
            }

            const statusType = options.getString('type');

            try {
                client.user.setPresence({
                    status: statusType
                });

                const statusEmojis = {
                    'online': '🟢',
                    'idle': '🟡',
                    'dnd': '🔴',
                    'invisible': '⚫'
                };

                const statusNames = {
                    'online': 'Online',
                    'idle': 'Idle',
                    'dnd': 'Do Not Disturb',
                    'invisible': 'Invisible'
                };

                const statusEmbed = new EmbedBuilder()
                    .setTitle("Bot Status Changed")
                    .setDescription(`${statusEmojis[statusType]} Status changed to: **${statusNames[statusType]}**`)
                    .setColor(config.appearance.color)
                    .setTimestamp()
                    .setFooter({ text: `Changed by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

                await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });

                await sendLog(
                    "🔄 Status Changed", 
                    `${interaction.user} changed bot status to **${statusNames[statusType]}** ${statusEmojis[statusType]}`, 
                    "#5865f2"
                );

            } catch (error) {
                console.error('Error changing status:', error);
                await interaction.reply({ content: 'An error occurred while changing status.', flags: MessageFlags.Ephemeral });
            }
        }

        if (commandName === 'dmall') {
            if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: "This command is for administrators only.", flags: MessageFlags.Ephemeral });
            }

            const message = options.getString('message');

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const ticketOwners = Object.values(data.tickets).map(ticket => ticket.owner);
            const uniqueOwners = [...new Set(ticketOwners)];

            if (uniqueOwners.length === 0) {
                return interaction.editReply({ content: "No open tickets found." });
            }

            let successCount = 0;
            let failedCount = 0;
            const failedUsers = [];

            for (const ownerId of uniqueOwners) {
                try {
                    const user = await client.users.fetch(ownerId).catch(() => null);
                    if (!user) {
                        failedCount++;
                        continue;
                    }

                    await user.send({ content: `${user}\n\n${message}` });
                    successCount++;
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    failedCount++;
                    failedUsers.push(ownerId);
                }
            }

            const resultEmbed = new EmbedBuilder()
                .setTitle("📤 Mass DM Complete")
                .setColor("#00ff00")
                .addFields(
                    { name: "✅ Successfully Sent", value: `${successCount}`, inline: true },
                    { name: "❌ Failed", value: `${failedCount}`, inline: true },
                    { name: "📊 Total", value: `${uniqueOwners.length}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `By ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

            if (failedUsers.length > 0) {
                const mentions = failedUsers.map(id => `<@${id}>`).join(', ');
                resultEmbed.addFields({ name: "Failed Users", value: mentions.length > 1024 ? `${failedUsers.length} users` : mentions });
            }

            await interaction.editReply({ embeds: [resultEmbed] });

            await sendLog(
                "📩 Mass DM Sent", 
                `${interaction.user} sent DM to **${successCount}** ticket owners\n**Message:** ${message}`, 
                "#3498db"
            );

            if (failedUsers.length > 0 && failedUsers.length <= 10) {
                const guild = interaction.guild;
                for (const userId of failedUsers) {
                    try {
                        const ticketChannel = Object.keys(data.tickets).find(channelId => data.tickets[channelId].owner === userId);
                        if (ticketChannel) {
                            const channel = await guild.channels.fetch(ticketChannel).catch(() => null);
                            if (channel) {
                                await channel.send({ content: `<@${userId}>\n\n${message}` });
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to send fallback message to ${userId}:`, err);
                    }
                }
            }
        }

    } catch (err) {
        console.error(err);
        sendErrorToLog('Slash Command Error', err.message);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred while executing this command.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

/* ========= [ Interactions Handler (Menu & Buttons) ] ========= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.guild || interaction.isChatInputCommand()) return;

  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_menu") {
      const type = interaction.values[0]; 
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

      const nameMap = { "استفسار": "inquire", "شكوى": "complaint", "شراكة": "partnership" };
      const englishName = nameMap[type] || "ticket";

      data.counter++;
      
      // ✅ تحديد الكاتقوري المناسب حسب نوع التذكرة
      let targetCategoryId;
      if (type === "استفسار") {
        targetCategoryId = INQUIRE_CATEGORY_ID;
      } else if (type === "شكوى") {
        targetCategoryId = COMPLAINT_CATEGORY_ID;
      } else if (type === "شراكة") {
        targetCategoryId = PARTNERSHIP_CATEGORY_ID;
      } else {
        targetCategoryId = TICKET_CATEGORY_ID; // احتياطي
      }

      let permissionOverwrites = [
  {
    id: interaction.guild.id,
    deny: [PermissionsBitField.Flags.ViewChannel]
  },
  {
    id: interaction.user.id,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.ReadMessageHistory
    ]
  }
];


if (type === "استفسار") {
  permissionOverwrites.push({
    id: SUPPORT_ROLE_ID,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.ReadMessageHistory
    ]
  });
}

      
  else if (type === "شكوى") {
  permissionOverwrites.push({
    id: ADMIN_MENTION_ROLE_ID,
     allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.ReadMessageHistory
    ]
  });
}

      
      else if (type === "شراكة") {
      permissionOverwrites.push({
       id: OWNER_ID,
       allow: [
         PermissionsBitField.Flags.ViewChannel,
         PermissionsBitField.Flags.SendMessages,
         PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.AddReactions,
         PermissionsBitField.Flags.ReadMessageHistory
    ]
  });
}


      const channel = await interaction.guild.channels.create({
        name: `${englishName}-${data.counter}`, 
        type: ChannelType.GuildText,
        parent: targetCategoryId, // ✅ استخدام الكاتقوري المناسب
        permissionOverwrites: permissionOverwrites
      }).catch(err => { throw new Error(`Failed to create channel: ${err.message}`) });

      data.tickets[channel.id] = { 
        owner: interaction.user.id, 
        type: type, 
        priority: "Normal",
        claimed: false,
        claimedBy: null
      };
      saveData();

      const dateString = new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });

      let mentionRole = "";
      if (type === "استفسار") mentionRole = `<@&${SUPPORT_ROLE_ID}>`;
      else if (type === "شكوى") mentionRole = `<@&${ADMIN_MENTION_ROLE_ID}>`;
      else if (type === "شراكة") mentionRole = `<@${OWNER_ID}>`;

      const ticketEmbed = new EmbedBuilder()
        .setColor(config.appearance.color)
        .setAuthor({ name: "Ticket Information", iconURL: interaction.guild.iconURL() })
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "Ticket Owner", value: `${interaction.user}`, inline: true },
          { name: "Responsible Team", value: mentionRole, inline: true },
          { name: "Created At", value: `\`${dateString}\``, inline: false },
          { name: "Department", value: `\`| ${type} |\``, inline: true },
          { name: "Ticket Number", value: `\`#${data.counter}\``, inline: true }
        )
        .setImage(config.appearance.image)
        .setFooter({ text: "Ticket Management System", iconURL: client.user.displayAvatarURL() });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${channel.id}`).setLabel("Claim Ticket").setEmoji("💼").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`options`).setLabel("Ticket Options").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
      );

      const ticketMessage = await channel.send({ content: `${interaction.user} | ${mentionRole}`, embeds: [ticketEmbed], components: [row] });
      await ticketMessage.pin().catch(() => {});
      
      // Store message ID for later editing
      data.tickets[channel.id].messageId = ticketMessage.id;
      saveData();
      
      await interaction.editReply({ content: `Your ticket has been opened successfully: ${channel}` });
      await sendLog("🎫 New Ticket", `${interaction.user} opened **${type}** ticket in ${channel}`, "#00ff00");
    }

    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
      const ticketData = data.tickets[interaction.channel.id];
      if (!ticketData) return interaction.reply({ content: "Error in ticket data.", flags: MessageFlags.Ephemeral });

      let hasPermission = false;
      if (ticketData.type === "استفسار" && interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) hasPermission = true;
      if (ticketData.type === "شكوى" && interaction.member.roles.cache.has(ADMIN_MENTION_ROLE_ID)) hasPermission = true;
      if (ticketData.type === "شراكة" && interaction.user.id === OWNER_ID) hasPermission = true;

      if (!hasPermission) return interaction.reply({ content: "You don't have permission to claim this ticket.", flags: MessageFlags.Ephemeral });

      if (ticketData.claimed) {
        return interaction.reply({ content: `This ticket is already claimed by <@${ticketData.claimedBy}>`, flags: MessageFlags.Ephemeral });
      }

      ticketData.claimed = true;
      ticketData.claimedBy = interaction.user.id;

      if (!data.claimStats[interaction.user.id]) {
        data.claimStats[interaction.user.id] = {
          claims: 0,
          username: interaction.user.tag
        };
      }
      data.claimStats[interaction.user.id].claims++;
      data.claimStats[interaction.user.id].username = interaction.user.tag;

      saveData();

      // Edit the original message to change button to unclaim
      try {
        const message = await interaction.channel.messages.fetch(ticketData.messageId);
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`unclaim_${interaction.channel.id}`).setLabel("Unclaim Ticket").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`options`).setLabel("Ticket Options").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
        );
        await message.edit({ components: [newRow] });
      } catch (err) {
        console.error("Error editing ticket message:", err);
      }

      await interaction.reply({ content: `Ticket claimed successfully by: ${interaction.user}` });
      await sendLog("💼 Ticket Claimed", `${interaction.user} claimed ${interaction.channel}\n**Total Claims:** ${data.claimStats[interaction.user.id].claims}`, "#5865f2");
    }

    if (interaction.isButton() && interaction.customId.startsWith("unclaim_")) {
      const ticketData = data.tickets[interaction.channel.id];
      if (!ticketData) return interaction.reply({ content: "Error in ticket data.", flags: MessageFlags.Ephemeral });

      if (!ticketData.claimed) {
        return interaction.reply({ content: "This ticket is not claimed.", flags: MessageFlags.Ephemeral });
      }

      if (ticketData.claimedBy !== interaction.user.id && interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only who claimed the ticket or owner can unclaim it.", flags: MessageFlags.Ephemeral });
      }

      const previousClaimer = ticketData.claimedBy;
      
      if (data.claimStats[previousClaimer]) {
        data.claimStats[previousClaimer].claims = Math.max(0, data.claimStats[previousClaimer].claims - 1);
      }

      ticketData.claimed = false;
      ticketData.claimedBy = null;
      saveData();

      // Edit the original message to change button back to claim
      try {
        const message = await interaction.channel.messages.fetch(ticketData.messageId);
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`claim_${interaction.channel.id}`).setLabel("Claim Ticket").setEmoji("💼").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`options`).setLabel("Ticket Options").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
        );
        await message.edit({ components: [newRow] });
      } catch (err) {
        console.error("Error editing ticket message:", err);
      }

      await interaction.reply({ content: `Ticket unclaimed successfully.` });
      await sendLog("🔓 Ticket Unclaimed", `${interaction.user} unclaimed ${interaction.channel}`, "#ff9900");
    }

    if (interaction.isButton() && interaction.customId === "options") {
      const ticketData = data.tickets[interaction.channel.id];
      if (!ticketData) return interaction.reply({ content: "Error in ticket data.", flags: MessageFlags.Ephemeral });

      let hasPermission = false;
      if (ticketData.type === "استفسار" && interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) hasPermission = true;
      if (ticketData.type === "شكوى" && interaction.member.roles.cache.has(ADMIN_MENTION_ROLE_ID)) hasPermission = true;
      if (ticketData.type === "شراكة" && interaction.user.id === OWNER_ID) hasPermission = true;

      if (!hasPermission) return interaction.reply({ content: "You don't have permission to manage this ticket.", flags: MessageFlags.Ephemeral });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`admin_actions_${interaction.channel.id}`)
        .setPlaceholder("Administrative Actions")
        .addOptions(
          { label: "Transcript", description: "Export conversation copy", value: "transcript", emoji: "📋" },
          { label: "Alert", description: "Send alert to ticket owner", value: "alert", emoji: "🔔" },
          { label: "Priority", description: "Change priority", value: "set_priority", emoji: "⭐" },
          { label: "Delete", description: "Delete ticket permanently", value: "delete", emoji: "🗑️" }
      );
      return interaction.reply({ content: "Management options:", components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("admin_actions_")) {
        const action = interaction.values[0];
        
        if (action === "transcript") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const attachment = await discordTranscripts.createTranscript(interaction.channel, { 
                limit: -1, 
                filename: `transcript-${interaction.channel.name}.html` 
            });
            await interaction.editReply({ content: "Transcript exported successfully:", files: [attachment] });
            await sendLog("📋 Transcript Exported", `${interaction.user} exported transcript from ${interaction.channel}`, "#3498db");
        }

        if (action === "alert") {
            const ticketData = data.tickets[interaction.channel.id];
            if (!ticketData) return interaction.reply({ content: "Ticket data not found.", flags: MessageFlags.Ephemeral });
            
            const owner = await interaction.guild.members.fetch(ticketData.owner).catch(() => null);
            if (!owner) return interaction.reply({ content: "Ticket owner not found.", flags: MessageFlags.Ephemeral });

            const alertEmbed = new EmbedBuilder()
                .setColor("#ff9900")
                .setTitle("Alert from Support Team")
                .setDescription(`Hello ${owner.user},\n\nYou have an open ticket in the server that needs your attention.\n\n**Ticket:** ${interaction.channel}\n**Message:** Please interact with the ticket or it will be closed soon.\n\nThank you!`)
                .setThumbnail(interaction.guild.iconURL())
                .setTimestamp()
                .setFooter({ text: "Support Team" });

            try {
                await owner.send({ embeds: [alertEmbed] });
                await interaction.reply({ content: `Alert sent successfully to DM of ${owner.user}!`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                await interaction.channel.send({ content: `${owner}`, embeds: [alertEmbed] });
                await interaction.reply({ content: `Could not send alert to DM (messages closed), sent in channel.`, flags: MessageFlags.Ephemeral });
            }
            
            await sendLog("🔔 Alert Sent", `${interaction.user} sent alert to ${owner.user} for ${interaction.channel}`, "#ff9900");
        }

        if (action === "set_priority") {
            const priorityMenu = new StringSelectMenuBuilder()
                .setCustomId(`priority_select_${interaction.channel.id}`)
                .setPlaceholder("Choose priority")
                .addOptions(
                    { label: "Normal", value: "Normal", emoji: "⚪" },
                    { label: "Medium", value: "Medium", emoji: "🟡" },
                    { label: "Urgent", value: "Urgent", emoji: "🔴" }
                );
            return interaction.reply({ 
                content: "Choose priority level:", 
                components: [new ActionRowBuilder().addComponents(priorityMenu)], 
                flags: MessageFlags.Ephemeral 
            });
        }


        if (action === "delete") {
            await interaction.reply("Deleting and archiving ticket...");
            const attachment = await discordTranscripts.createTranscript(interaction.channel, { 
                limit: -1, 
                filename: `closed-${interaction.channel.name}.html` 
            });
            await sendLog("🗑️ Ticket Deleted", `${interaction.user} deleted **${interaction.channel.name}**`, "#ff0000", [], [attachment]);
            
            delete data.tickets[interaction.channel.id];
            saveData();
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("priority_select_")) {
        const priority = interaction.values[0];
        const ticketData = data.tickets[interaction.channel.id];
        
        if (!ticketData) return interaction.reply({ content: "Error identifying ticket.", flags: MessageFlags.Ephemeral });

        ticketData.priority = priority;
        saveData();

        const priorityMap = { "Normal": "normal", "Medium": "medium", "Urgent": "urgent" };
        const priorityEmoji = { "Normal": "⚪", "Medium": "🟡", "Urgent": "🔴" };
        const englishPriority = priorityMap[priority];
        
        const currentName = interaction.channel.name;
        const baseName = currentName.split('-').slice(0, 2).join('-');
        const newName = `${baseName}-${englishPriority}`;
        
        await interaction.channel.setName(newName).catch(err => console.error("Error changing channel name:", err));

        await interaction.reply({ content: `Priority changed to: ${priorityEmoji[priority]} **${priority}**\nChannel name updated to: \`${newName}\`` });
        await sendLog("⭐ Priority Changed", `${interaction.user} changed **${interaction.channel}** priority to **${priority}**`, "#f1c40f");
    }

  } catch (error) {
    console.error(error);
    sendErrorToLog('Interaction Error', error.message);
  }
});


/* ========= [ Main Panel Message (Prefix) ] ========= */
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (
      message.content === "!tickets" &&
      message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      const mainEmbed = new EmbedBuilder()
        .setTitle("Ticket System")
        .setDescription("اختر القسم المناسب لك وبنرد عليك بأسرع وقت ان شاء الله")
        .setImage(config.appearance.image)
        .setColor(config.appearance.color);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("ticket_menu")
        .setPlaceholder("Choose ticket category")
        .addOptions(
          {
            label: "Inquire",
            value: "استفسار",
            emoji: "❓",
            description: "استفسار عام أو مساعدة"
          },
          {
            label: "Complaints",
            value: "شكوى",
            emoji: "⚠️",
            description: "شكوى على لاعب"
          },
          {
            label: "Partnership",
            value: "شراكة",
            emoji: "🤝",
            description: "شراكة مع السيرفر"
          }
        );

      await message.channel.send({
        embeds: [mainEmbed],
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }
  } catch (err) {
    console.error("[Message Error]", err);
  }
});

/* ================== [ Bot Login ] ================== */
client.login(TOKEN);