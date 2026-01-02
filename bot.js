require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
  AttachmentBuilder,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ID = process.env.ADMIN_ID || '1447241366173122661';
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;

const paypalEmail = 'davilucasfirme@gmail.com';
const pixCode = '00020101021126580014br.gov.bcb.pix01362ae62571-4089-4c92-b550-47484fa67bdd5204000053039865802BR5919DAVI L F DOS SANTOS6013MONSENHOR HIP62070503***6304BD67';

const PRODUCTS_FOLDER = 'D:\\Documentos\\Bot_Parceria\\Products';
const storeFile = path.join(__dirname, 'store.json');

let store = { categories: {} };

if (fs.existsSync(storeFile)) {
  try {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  } catch (err) {
    console.error('Erro ao carregar store.json:', err);
  }
}

if (!fs.existsSync(PRODUCTS_FOLDER)) {
  fs.mkdirSync(PRODUCTS_FOLDER, { recursive: true });
}

// Funções de estoque
function getEstoqueDisponivel(productName) {
  if (!fs.existsSync(PRODUCTS_FOLDER)) return 0;
  const files = fs.readdirSync(PRODUCTS_FOLDER);
  const normalized = productName.toLowerCase().trim();
  return files.filter(f => f.toLowerCase().startsWith(normalized) && f.endsWith('.txt')).length;
}

function getArquivoProduto(productName) {
  if (!fs.existsSync(PRODUCTS_FOLDER)) return null;
  const files = fs.readdirSync(PRODUCTS_FOLDER);
  const normalized = productName.toLowerCase().trim();
  const match = files.find(f => f.toLowerCase().startsWith(normalized) && f.endsWith('.txt'));
  return match ? path.join(PRODUCTS_FOLDER, match) : null;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`Bot da loja online como ${client.user.tag}! Pronto para vendas 🛒`);
});

const commands = [
  new SlashCommandBuilder()
    .setName('publicar_loja')
    .setDescription('Publica a loja no canal atual')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('adicionar_produto')
    .setDescription('Adiciona um produto à loja')
    .addStringOption(o => o.setName('categoria').setDescription('Categoria').setRequired(true))
    .addStringOption(o => o.setName('nome').setDescription('Nome do produto').setRequired(true))
    .addStringOption(o => o.setName('preco').setDescription('Preço').setRequired(true))
    .addStringOption(o => o.setName('descricao').setDescription('Descrição (opcional)'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('confirmar_compra')
    .setDescription('Confirma a compra e envia o produto ao comprador')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Comandos registrados!');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }
})();

const navigationState = new Map();

client.on('interactionCreate', async (interaction) => {
  try {
    // ================ /adicionar_produto ================
    if (interaction.isChatInputCommand() && interaction.commandName === 'adicionar_produto') {
      await interaction.deferReply({ ephemeral: true });

      const cat = interaction.options.getString('categoria');
      const nome = interaction.options.getString('nome');
      const preco = interaction.options.getString('preco');
      const desc = interaction.options.getString('descricao') || 'Sem descrição';

      if (!store.categories[cat]) store.categories[cat] = [];
      store.categories[cat].push({ name: nome, price: preco, desc });

      fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));

      await interaction.editReply({ content: `✅ Produto **${nome}** adicionado em **${cat}** por ${preco}!` });
      return;
    }

    // ================ /publicar_loja ================
    if (interaction.isChatInputCommand() && interaction.commandName === 'publicar_loja') {
      await interaction.deferReply();

      if (Object.keys(store.categories).length === 0) {
        return interaction.editReply({ content: '❌ Loja vazia! Use /adicionar_produto.' });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('loja_select_categoria')
        .setPlaceholder('Escolha uma categoria...')
        .addOptions(Object.keys(store.categories).map(cat => ({ label: cat, value: cat })));

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.editReply({
        content: '🛒 **LOJA ABERTA!** Escolha uma categoria abaixo:',
        components: [row],
      });
      return;
    }

    // ================ Seleção de categoria ================
    if (interaction.isStringSelectMenu() && interaction.customId === 'loja_select_categoria') {
      await interaction.deferUpdate();

      const category = interaction.values[0];
      const products = store.categories[category];

      if (!products || products.length === 0) {
        return interaction.editReply({ content: '❌ Categoria vazia.', components: [] });
      }

      navigationState.set(interaction.message.id, {
        category,
        index: 0,
        products,
      });

      const product = products[0];
      const estoque = getEstoqueDisponivel(product.name);

      const embed = new EmbedBuilder()
        .setTitle(product.name)
        .setDescription(product.desc || 'Sem descrição.')
        .addFields(
          { name: '💰 Preço', value: product.price, inline: true },
          { name: '📦 Estoque', value: estoque > 0 ? `${estoque}` : 'Esgotado', inline: true }
        )
        .setColor(estoque > 0 ? '#00ff00' : '#ff0000')
        .setFooter({ text: `1 / ${products.length} • ${category}` });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('loja_prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('loja_buy').setLabel('Comprar').setStyle(estoque > 0 ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(estoque === 0),
        new ButtonBuilder().setCustomId('loja_next').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(products.length === 1)
      );

      await interaction.editReply({
        content: `**Categoria:** ${category}`,
        embeds: [embed],
        components: [buttons],
      });

      const collector = interaction.message.createMessageComponentCollector({
        filter: () => true,
        time: null, // Loja aberta pra sempre
      });

      collector.on('collect', async (i) => {
        await i.deferUpdate();

        const state = navigationState.get(interaction.message.id);
        if (!state) return;

        if (i.customId === 'loja_prev') {
          state.index = Math.max(0, state.index - 1);
        } else if (i.customId === 'loja_next') {
          state.index = Math.min(state.products.length - 1, state.index + 1);
        } else if (i.customId === 'loja_buy') {
          const product = state.products[state.index];
          const estoque = getEstoqueDisponivel(product.name);

          if (estoque === 0) {
            await i.followUp({ content: '❌ Produto esgotado!', ephemeral: true });
            return;
          }

          try {
            const safeName = product.name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
            const channelName = `compra-${i.user.username.toLowerCase()}-${safeName}`;

            const ticketChannel = await i.guild.channels.create({
              name: channelName,
              type: ChannelType.GuildText,
              parent: TICKET_CATEGORY_ID || null,
              topic: i.user.id.toString(),
              permissionOverwrites: [
                { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: ADMIN_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
              ],
            });

            const qr = await QRCode.toBuffer(pixCode, { width: 400 });
            const qrAttach = new AttachmentBuilder(qr, { name: 'pix_qr.png' });

            const embed = new EmbedBuilder()
              .setTitle(`💸 Pagamento - ${product.name}`)
              .setDescription(`Olá ${i.user}!\n\n**Valor:** ${product.price}\n\nApós pagar, avise o admin para confirmar com **/confirmar_compra**.`)
              .addFields(
                { name: 'PayPal', value: paypalEmail },
                { name: 'Pix Copia e Cola', value: `\`\`\`${pixCode}\`\`\`` }
              )
              .setThumbnail('attachment://pix_qr.png')
              .setColor('#00ff88');

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('close_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
              content: `${i.user} <@${ADMIN_ID}>`,
              embeds: [embed],
              files: [qrAttach],
              components: [row],
            });

            await i.followUp({ content: `✅ Seu ticket foi criado: ${ticketChannel}`, ephemeral: true });
          } catch (err) {
            console.error('Erro ao criar ticket:', err);
            await i.followUp({ content: '❌ Erro ao criar ticket.', ephemeral: true });
          }

          return;
        }

        // Atualiza após navegação
        const p = state.products[state.index];
        const est = getEstoqueDisponivel(p.name);

        const newEmbed = EmbedBuilder.from(embed)
          .setTitle(p.name)
          .setDescription(p.desc || 'Sem descrição.')
          .spliceFields(0, 2,
            { name: '💰 Preço', value: p.price, inline: true },
            { name: '📦 Estoque', value: est > 0 ? `${est}` : 'Esgotado', inline: true }
          )
          .setColor(est > 0 ? '#00ff00' : '#ff0000')
          .setFooter({ text: `${state.index + 1} / ${state.products.length} • ${state.category}` });

        const newButtons = ActionRowBuilder.from(buttons);
        newButtons.components[0].setDisabled(state.index === 0);
        newButtons.components[1].setDisabled(est === 0).setStyle(est > 0 ? ButtonStyle.Success : ButtonStyle.Danger);
        newButtons.components[2].setDisabled(state.index === state.products.length - 1);

        await i.editReply({ embeds: [newEmbed], components: [newButtons] });
      });
    }

    // ================ /confirmar_compra ================
    if (interaction.isChatInputCommand() && interaction.commandName === 'confirmar_compra') {
      if (interaction.user.id !== ADMIN_ID && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ Apenas admins podem confirmar compras.', ephemeral: true });
      }

      await interaction.deferReply();

      const buyerId = interaction.channel?.topic;
      if (!buyerId) {
        return interaction.editReply({ content: '❌ Use este comando dentro do ticket do comprador.' });
      }

      const buyer = await client.users.fetch(buyerId).catch(() => null);
      if (!buyer) {
        return interaction.editReply({ content: '❌ Comprador não encontrado.' });
      }

      let productName = interaction.channel.name.replace(/^compra[-_]?/i, '').replace(/^🛒[-_]?/i, '');
      const parts = productName.split('-');
      if (parts.length > 1) {
        productName = parts.slice(1).join(' ');
      }

      const filePath = getArquivoProduto(productName.trim());
      if (!filePath) {
        return interaction.editReply({ content: `❌ Arquivo não encontrado para "${productName}".` });
      }

      const attachment = new AttachmentBuilder(filePath, { name: path.basename(filePath) });

      try {
        await buyer.send({
          content: '🎉 Obrigado pela compra! Aqui está seu produto:',
          files: [attachment],
        });

        await interaction.editReply({ content: `✅ Produto enviado para ${buyer} com sucesso!` });

        await interaction.followUp({ content: '🔒 Ticket será fechado em 10 segundos...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
      } catch (err) {
        console.error('Erro ao enviar DM:', err);
        await interaction.editReply({ content: '❌ Erro ao enviar produto (DM fechada?).' });
      }
      return;
    }

    // ================ Fechar ticket ================
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      if (interaction.user.id !== ADMIN_ID && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ Apenas admins podem fechar.', ephemeral: true });
      }

      await interaction.reply({ content: '🗑️ Ticket fechado!' });
      await interaction.channel.delete().catch(() => {});
    }
  } catch (error) {
    console.error('Erro crítico:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Erro inesperado.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(TOKEN);