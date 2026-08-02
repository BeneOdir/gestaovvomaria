const JWT_SECRET = "vovomaria_mvp_2026_trocar_depois";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function onlyNumbers(v = "") {
  return String(v || "").replace(/\D/g, "");
}

function normalizeText(v = "") {
  return String(v || "").trim();
}

function filtroRegistroTeste(alias = "v", somenteTeste = false) {
  const texto = `LOWER(' ' || COALESCE(${alias}.observacoes, '') || ' ')`;
  const contemPalavraTeste = `${texto} GLOB '*[^0-9a-zÀ-ÿ_]teste[^0-9a-zÀ-ÿ_]*'`;
  return somenteTeste ? contemPalavraTeste : `NOT (${contemPalavraTeste})`;
}

async function jwtSign(payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${body}.${sig64}`;
}

async function jwtVerify(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!h || !b || !s) throw new Error("Token inválido");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sig = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${h}.${b}`));
  if (!ok) throw new Error("Token inválido");
  return JSON.parse(atob(b));
}

async function getUser(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    return await jwtVerify(auth.replace("Bearer ", ""));
  } catch {
    return null;
  }
}

async function login(request, env) {
  const { email, senha } = await request.json();

  const vendedor = await env.DB.prepare(
    "SELECT id, nome, email, senha_hash, role, status FROM vendedores WHERE email = ?"
  ).bind(normalizeText(email)).first();

  if (!vendedor || vendedor.status === "inativo" || senha !== vendedor.senha_hash) {
    return json({ error: "Credenciais inválidas" }, 401);
  }

  const token = await jwtSign({
    vendedorId: vendedor.id,
    nome: vendedor.nome,
    role: vendedor.role || "vendedor",
  });

  return json({
    token,
    vendedor: {
      id: vendedor.id,
      nome: vendedor.nome,
      email: vendedor.email,
      role: vendedor.role || "vendedor",
    },
  });
}

function montarCliente(d, user) {
  const tipoPessoa = normalizeText(d.tipo_pessoa || (d.cnpj ? "PJ" : "PF")).toUpperCase();
  const cnpj = onlyNumbers(d.cnpj);
  const cpf = onlyNumbers(d.cpf);
  const documento = onlyNumbers(d.documento) || (tipoPessoa === "PF" ? cpf : cnpj);

  return {
    vendedor_id: d.vendedor_id || user.vendedorId,
    tipo_pessoa: tipoPessoa === "PF" ? "PF" : "PJ",
    documento,
    cnpj,
    cpf,
    razao_social: normalizeText(d.razao_social || d.nome_estabelecimento),
    nome_estabelecimento: normalizeText(d.nome_estabelecimento || d.razao_social || d.nome_fantasia),
    nome_fantasia: normalizeText(d.nome_fantasia || d.nome_estabelecimento || d.razao_social),
    ie: normalizeText(d.ie),
    situacao_ie: normalizeText(d.situacao_ie || (d.ie ? "informada" : "pendente")),
    responsavel_empresa: normalizeText(d.responsavel_empresa),
    responsavel_compra: normalizeText(d.responsavel_compra),
    telefone: onlyNumbers(d.telefone),
    whatsapp: onlyNumbers(d.whatsapp),
    instagram: normalizeText(d.instagram),
    email: normalizeText(d.email),
    contato_emergencia: normalizeText(d.contato_emergencia),
    cep: onlyNumbers(d.cep),
    endereco: normalizeText(d.endereco),
    cidade: normalizeText(d.cidade),
    estado: normalizeText(d.estado).toUpperCase(),
    concorrentes: normalizeText(d.concorrentes),
    observacoes_gerais: normalizeText(d.observacoes_gerais),
    status_comercial: normalizeText(d.status_comercial || d.status_cliente || "prospect"),
    status_cliente: normalizeText(d.status_cliente || "ativo"),
    ultima_visita: normalizeText(d.ultima_visita),
  };
}

function validarCliente(c) {
  const faltando = [];
  if (!c.tipo_pessoa) faltando.push("tipo_pessoa");
  if (!c.documento) faltando.push("documento");
  if (c.tipo_pessoa === "PJ" && !c.cnpj) faltando.push("cnpj");
  if (c.tipo_pessoa === "PF" && !c.cpf) faltando.push("cpf");
  if (!c.nome_fantasia && !c.razao_social && !c.nome_estabelecimento) faltando.push("nome");
  if (!c.cidade) faltando.push("cidade");
  if (!c.estado) faltando.push("estado");
  return faltando;
}

async function listarClientes(env, user) {
  const result = await env.DB.prepare(`
    SELECT c.*, vd.nome AS vendedor_nome
    FROM clientes c
    LEFT JOIN vendedores vd ON vd.id = c.vendedor_id
    ORDER BY c.nome_estabelecimento COLLATE NOCASE, c.id DESC
  `).all();

  return json(result.results || []);
}
async function criarCliente(request, env, user) {
  const entrada = await request.json();
  const c = montarCliente(entrada, user);
  const faltando = validarCliente(c);

  if (faltando.length) {
    return json({ error: "Campos obrigatórios faltando", campos: faltando }, 400);
  }

  const existente = await env.DB.prepare(
    "SELECT id, nome_fantasia, razao_social FROM clientes WHERE documento = ?"
  ).bind(c.documento).first();

  if (existente) {
    return json({ error: "Cliente já cadastrado com este documento", existente }, 409);
  }

  const res = await env.DB.prepare(`
    INSERT INTO clientes (
      vendedor_id, tipo_pessoa, documento, cnpj, cpf,
      razao_social, nome_estabelecimento, nome_fantasia,
      ie, situacao_ie,
      responsavel_empresa, responsavel_compra,
      telefone, whatsapp, instagram, email, contato_emergencia,
      cep, endereco, cidade, estado,
      concorrentes, observacoes_gerais,
      status_comercial, status_cliente, ultima_visita,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    c.vendedor_id, c.tipo_pessoa, c.documento, c.cnpj, c.cpf,
    c.razao_social, c.nome_estabelecimento, c.nome_fantasia,
    c.ie, c.situacao_ie,
    c.responsavel_empresa, c.responsavel_compra,
    c.telefone, c.whatsapp, c.instagram, c.email, c.contato_emergencia,
    c.cep, c.endereco, c.cidade, c.estado,
    c.concorrentes, c.observacoes_gerais,
    c.status_comercial, c.status_cliente, c.ultima_visita
  ).run();

  return json({ success: true, id: res.meta.last_row_id, cliente: c });
}

async function criarClienteAvulso(request, env, user) {
  const dados = await request.json();
  const nomeEstabelecimento = normalizeText(dados.nome_estabelecimento);
  const cpf = onlyNumbers(dados.cpf);
  const cnpj = onlyNumbers(dados.cnpj);
  const tipoInformado = normalizeText(dados.tipo_pessoa).toUpperCase();
  const tipoPessoa = tipoInformado === "PF" || tipoInformado === "PJ"
    ? tipoInformado
    : (cnpj ? "PJ" : (cpf ? "PF" : null));

  if (!nomeEstabelecimento) {
    return json({ error: "Informe o nome ou identificação do cliente." }, 400);
  }
  if (cpf && cpf.length !== 11) {
    return json({ error: "CPF deve conter 11 dígitos." }, 400);
  }
  if (cnpj && cnpj.length !== 14) {
    return json({ error: "CNPJ deve conter 14 dígitos." }, 400);
  }
  if (cpf && cnpj) {
    return json({ error: "Informe somente CPF ou CNPJ." }, 400);
  }

  const cliente = {
    vendedor_id: user.vendedorId,
    tipo_pessoa: tipoPessoa,
    cnpj: cnpj || null,
    cpf: cpf || null,
    nome_estabelecimento: nomeEstabelecimento,
    telefone: onlyNumbers(dados.telefone) || null,
    whatsapp: onlyNumbers(dados.whatsapp) || null,
    cep: onlyNumbers(dados.cep) || null,
    endereco: normalizeText(dados.endereco) || null,
    cidade: normalizeText(dados.cidade) || null,
    estado: normalizeText(dados.estado).toUpperCase() || null,
    observacoes_gerais: normalizeText(dados.observacoes_gerais) || null,
    status_cadastro: "incompleto",
  };

  let res;
  try {
    console.log("DIAGNOSTICO criarClienteAvulso:", {
      dbExiste: !!env?.DB,
      nome: dados.nome_estabelecimento,
      vendedorId: user?.vendedorId
    });

    res = await env.DB.prepare(`
      INSERT INTO clientes_avulsos (
        vendedor_id, nome_estabelecimento, tipo_pessoa, cpf, cnpj,
        telefone, whatsapp, cep, endereco, cidade, estado, observacoes_gerais,
        status_cadastro,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      cliente.vendedor_id, cliente.nome_estabelecimento, cliente.tipo_pessoa,
      cliente.cpf, cliente.cnpj, cliente.telefone, cliente.whatsapp,
      cliente.cep, cliente.endereco,
      cliente.cidade, cliente.estado, cliente.observacoes_gerais,
      cliente.status_cadastro
    ).run();
  } catch (err) {
    console.error("ERRO criarClienteAvulso:", {
      message: err?.message,
      stack: err?.stack,
      dbExiste: !!env?.DB
    });

    return json({
      error: "Não foi possível salvar o cliente avulso.",
      detalhe: err.message,
    }, 500);
  }

  const criado = { id: res.meta.last_row_id, ...cliente, tipo_origem: "avulso" };
  return json({ success: true, id: criado.id, cliente: criado });
}

async function listarClientesAvulsos(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      nome_estabelecimento,
      telefone,
      whatsapp,
      cep,
      endereco,
      cidade,
      estado,
      observacoes_gerais,
      'avulso' AS tipo_origem
    FROM clientes_avulsos
    ORDER BY nome_estabelecimento COLLATE NOCASE, id DESC
  `).all();

  return json(result.results || []);
}

async function sync(request, env, user) {
  try {
    const body = await request.json();
    const acoes = Array.isArray(body.acoes) ? body.acoes : [];
    const resultados = [];

    for (const acao of acoes) {
      if (acao.entidade !== "cliente" || acao.acao !== "INSERT") {
        resultados.push({ ok: false, motivo: "ação ignorada", acao });
        continue;
      }

      const dados = typeof acao.dados === "string" ? JSON.parse(acao.dados) : acao.dados;

      const fake = new Request("https://local/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });

      const resp = await criarCliente(fake, env, user);
      const retorno = await resp.json();

      resultados.push({
        local_id: acao.local_id || acao.id || null,
        ok: resp.ok,
        status: resp.status,
        retorno,
      });
    }

    return json({ success: true, resultados });
    } catch (err) {
    return json({
      success: false,
      error: err.message,
      stack: err.stack
    }, 500);
  }
}
async function consultarCNPJ(request) {
  try {
    const url = new URL(request.url);
    const cnpj = onlyNumbers(url.pathname.split("/").pop());

    if (cnpj.length !== 14) {
      return json({ error: "CNPJ inválido" }, 400);
    }

    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const texto = await resp.text();

    let data;
    try {
      data = JSON.parse(texto);
    } catch {
      data = { error: texto || "Resposta inválida da API de CNPJ" };
    }

    if (!resp.ok) {
      return json({
        error: data.message || data.error || "CNPJ não encontrado",
        origem: "BrasilAPI",
        status: resp.status
      }, resp.status);
    }

    return json(data);
  } catch (err) {
    return json({
      error: "Erro interno ao consultar CNPJ",
      detalhe: err.message
    }, 500);
  }
}

async function health(env) {
  try {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return json({ status: "ok", api: "Gestão Vovó Maria", banco: "conectado", tabelas: tables.results });
  } catch (err) {
    return json({ status: "erro", error: err.message }, 500);
  }
}

async function listarProdutos(request, env, user) {
  const incluirInativos = user.role === "admin" && new URL(request.url).searchParams.get("todos") === "1";
  const result = await env.DB.prepare(
    incluirInativos
      ? "SELECT * FROM produtos ORDER BY nome"
      : "SELECT * FROM produtos WHERE ativo = 1 OR ativo = 'ativo' ORDER BY nome"
  ).all();

  return json(result.results || []);
}

async function gerirProduto(request, env, user, id = null) {
  if (user.role !== "admin") return json({ error: "Acesso restrito ao administrador" }, 403);
  const d = await request.json();
  const nome = normalizeText(d.nome);
  const preco = Number(d.preco ?? d.preco_padrao);
  const ativo = d.ativo === false || d.ativo === 0 || d.ativo === "0" || d.ativo === "inativo" ? 0 : 1;
  if (!nome) return json({ error: "Informe o nome do produto." }, 400);
  if (!Number.isFinite(preco) || preco < 0) return json({ error: "Informe um preço válido e não negativo." }, 400);

  if (id) {
    const atual = await env.DB.prepare("SELECT id FROM produtos WHERE id = ?").bind(id).first();
    if (!atual) return json({ error: "Produto não encontrado." }, 404);
    await env.DB.prepare("UPDATE produtos SET nome = ?, preco_padrao = ?, ativo = ? WHERE id = ?")
      .bind(nome, preco, ativo, id).run();
    return json({ success: true, produto: { id, nome, preco_padrao: preco, ativo } });
  }

  const res = await env.DB.prepare("INSERT INTO produtos (nome, preco_padrao, ativo, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)")
    .bind(nome, preco, ativo).run();
  return json({ success: true, produto: { id: res.meta.last_row_id, nome, preco_padrao: preco, ativo } }, 201);
}

async function criarVisita(request, env, user) {
  try {
    const d = await request.json();
    const clienteId = Number(d.cliente_id || 0);
    const dataVisita = normalizeText(d.data_visita || new Date().toISOString().slice(0,10));
    const comprou = d.comprou === "sim" || d.comprou === true ? "sim" : "nao";
    const observacoes = normalizeText(d.observacoes);
    const itens = Array.isArray(d.itens) ? d.itens : [];

    if (!clienteId) return json({ error: "Selecione um cliente." }, 400);

    const cliente = await env.DB.prepare("SELECT id, nome_fantasia, razao_social, vendedor_id FROM clientes WHERE id = ?").bind(clienteId).first();
    if (!cliente) return json({ error: "Cliente não encontrado." }, 404);
    
    let valorTotal = 0;
    const itensLimpos = itens
      .map(i => {
        const quantidade = Number(i.quantidade || 0);
        const preco = Number(i.preco_unitario || 0);
        const subtotal = quantidade * preco;
        valorTotal += subtotal;
        return {
          produto_id: i.produto_id ? Number(i.produto_id) : null,
          produto_nome: normalizeText(i.produto_nome),
          quantidade,
          preco_unitario: preco,
          subtotal
        };
      })
      .filter(i => i.quantidade > 0 && i.produto_nome);

    const visitaRes = await env.DB.prepare(`
      INSERT INTO visitas (vendedor_id, cliente_id, data_visita, comprou, valor_total, observacoes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(user.vendedorId, clienteId, dataVisita, comprou, valorTotal, observacoes).run();

    const visitaId = visitaRes.meta.last_row_id;

    for (const item of itensLimpos) {
      await env.DB.prepare(`
        INSERT INTO visita_itens (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(visitaId, item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal).run();
    }

    await env.DB.prepare("UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(dataVisita, clienteId).run();

    return json({ success: true, visita_id: visitaId, valor_total: valorTotal, itens: itensLimpos.length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function listarVisitas(request, env, user) {
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || new Date().toISOString().slice(0,10);
  let result;
  if (user.role === "admin") {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND ${filtroRegistroTeste("v")}
      ORDER BY v.id DESC
    `).bind(data).all();
  } else {
    result = await env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND ${filtroRegistroTeste("v")}
      ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all();
  }
  return json(result.results || []);
}

async function relatorioDia(request, env, user) {
  const url = new URL(request.url);
  const data = url.searchParams.get("data") || new Date().toISOString().slice(0,10);
  const filtroVendedor = user.role === "admin" ? "" : " AND vendedor_id = ?";
  const params = user.role === "admin" ? [data] : [data, user.vendedorId];

  const resumo = await env.DB.prepare(`
    SELECT
      COUNT(*) AS visitas,
      SUM(CASE WHEN comprou = 'sim' THEN 1 ELSE 0 END) AS compras,
      SUM(CASE WHEN comprou = 'nao' THEN 1 ELSE 0 END) AS sem_compra,
      COALESCE(SUM(valor_total), 0) AS valor_total
    FROM visitas v
    WHERE data_visita = ?${filtroVendedor} AND ${filtroRegistroTeste("v")}
  `).bind(...params).first();

  const itens = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade),0) AS quantidade, COALESCE(SUM(vi.subtotal),0) AS total
    FROM visita_itens vi
    INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita = ?${user.role === "admin" ? "" : " AND v.vendedor_id = ?"}
      AND ${filtroRegistroTeste("v")}
    GROUP BY vi.produto_nome
    ORDER BY quantidade DESC
  `).bind(...params).all();

  const visitas = await (user.role === "admin"
    ? env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data).all()
    : env.DB.prepare(`
      SELECT v.*, c.nome_fantasia, c.razao_social, vd.nome AS vendedor_nome
      FROM visitas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita = ? AND v.vendedor_id = ? AND ${filtroRegistroTeste("v")} ORDER BY v.id DESC
    `).bind(data, user.vendedorId).all());

  return json({ data, resumo, produtos: itens.results || [], visitas: visitas.results || [] });
}
async function criarVenda(request, env, user) {
  const d = await request.json();
  const clienteId = Number(d.cliente_id || 0);
  const clienteAvulsoId = Number(d.cliente_avulso_id || 0);
  const dataVisita = normalizeText(d.data_visita || new Date().toISOString().slice(0, 10));
  const comprou = d.comprou === "sim" || d.comprou === true ? "sim" : "nao";
  const observacoes = normalizeText(d.observacoes);
  const formaPagamento = normalizeText(d.forma_pagamento || "não informado").toLowerCase();
  const desconto = Number(d.desconto || 0);
  const itensEntrada = Array.isArray(d.itens)
    ? d.itens
    : (Array.isArray(d.produtos) ? d.produtos : []);

  if (!user?.vendedorId) return json({ error: "Vendedor autenticado não identificado." }, 401);
  if ((!clienteId && !clienteAvulsoId) || (clienteId && clienteAvulsoId)) {
    return json({ error: "Selecione exatamente um cliente cadastrado ou avulso." }, 400);
  }
  if (!Number.isFinite(desconto) || desconto < 0) return json({ error: "Desconto inválido." }, 400);

  const cliente = clienteId
    ? await env.DB.prepare("SELECT id, nome_fantasia, razao_social, nome_estabelecimento FROM clientes WHERE id = ?").bind(clienteId).first()
    : await env.DB.prepare("SELECT id, nome_estabelecimento FROM clientes_avulsos WHERE id = ?").bind(clienteAvulsoId).first();
  if (!cliente) return json({ error: "Cliente não encontrado." }, 404);

  const itens = itensEntrada.map(item => {
    const quantidade = Number(item.quantidade);
    const precoUnitario = Number(item.preco_unitario);
    return {
      produto_id: Number(item.produto_id || 0) || null,
      produto_nome: normalizeText(item.produto_nome),
      quantidade,
      preco_unitario: precoUnitario,
      subtotal: quantidade * precoUnitario
    };
  }).filter(item => item.produto_id || item.produto_nome || item.quantidade || item.preco_unitario);

  if (comprou === "sim" && !itens.length) return json({ error: "Adicione ao menos um produto." }, 400);
  if (itens.some(item => !item.produto_nome || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.preco_unitario) || item.preco_unitario < 0)) {
    return json({ error: "Todos os itens devem ter produto, quantidade maior que zero e preço não negativo." }, 400);
  }

  const subtotal = comprou === "sim" ? itens.reduce((soma, item) => soma + item.subtotal, 0) : 0;
  if (desconto > subtotal) return json({ error: "O desconto não pode superar o subtotal." }, 400);
  const valorTotal = subtotal - desconto;
  const recebidoInformado = Number(d.valor_recebido ?? valorTotal);
  if (!Number.isFinite(recebidoInformado) || recebidoInformado < 0) return json({ error: "Valor recebido inválido." }, 400);
  const valorRecebido = Math.min(recebidoInformado, valorTotal);
  const situacaoPagamento = valorTotal === 0 ? "sem_venda" : valorRecebido >= valorTotal ? "pago" : valorRecebido > 0 ? "parcial" : "pendente";

  const visitaRes = await env.DB.prepare(`
    INSERT INTO visitas (
      vendedor_id, cliente_id, cliente_avulso_id, data_visita, comprou,
      valor_total, observacoes, forma_pagamento, valor_recebido, desconto,
      situacao_pagamento, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(user.vendedorId, clienteId || 0, clienteAvulsoId || null, dataVisita, comprou,
    valorTotal, observacoes, formaPagamento, valorRecebido, desconto, situacaoPagamento).run();
  const visitaId = visitaRes.meta.last_row_id;

  try {
    if (itens.length) {
      await env.DB.batch(itens.map(item => env.DB.prepare(`
        INSERT INTO visita_itens (visita_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(visitaId, item.produto_id, item.produto_nome, item.quantidade, item.preco_unitario, item.subtotal)));
    }
  } catch (err) {
    await env.DB.prepare("DELETE FROM visitas WHERE id = ?").bind(visitaId).run();
    throw err;
  }

  if (clienteId) {
    await env.DB.prepare("UPDATE clientes SET ultima_visita = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(dataVisita, clienteId).run();
  }

  return json({
    success: true, visita_id: visitaId, data_visita: dataVisita,
    cliente: cliente.nome_fantasia || cliente.razao_social || cliente.nome_estabelecimento || "Consumidor",
    vendedor: user.nome || "Vendedor", itens, subtotal, desconto,
    valor_total: valorTotal, valor_recebido: valorRecebido,
    forma_pagamento: formaPagamento, situacao_pagamento: situacaoPagamento
  });
}

async function relatorioPeriodo(request, env, user, somenteTeste = false) {
  const url = new URL(request.url);
  const hoje = new Date().toISOString().slice(0, 10);
  const dataInicial = url.searchParams.get("data_inicial") || url.searchParams.get("data") || hoje;
  const dataFinal = url.searchParams.get("data_final") || url.searchParams.get("data") || dataInicial;
  if (dataInicial > dataFinal) return json({ error: "A data inicial deve ser anterior à data final." }, 400);
  const filtro = user.role === "admin" ? "" : " AND v.vendedor_id = ?";
  const filtroTeste = filtroRegistroTeste("v", somenteTeste);
  const params = user.role === "admin" ? [dataInicial, dataFinal] : [dataInicial, dataFinal, user.vendedorId];

  const resumo = await env.DB.prepare(`
    SELECT COUNT(*) AS visitas,
      SUM(CASE WHEN v.comprou = 'sim' THEN 1 ELSE 0 END) AS compras,
      SUM(CASE WHEN v.comprou = 'nao' THEN 1 ELSE 0 END) AS sem_compra,
      COALESCE(SUM(v.valor_total + v.desconto), 0) AS total_bruto,
      COALESCE(SUM(v.valor_total), 0) AS valor_total,
      COALESCE(SUM(v.valor_recebido), 0) AS total_recebido,
      COALESCE(SUM(v.valor_total - v.valor_recebido), 0) AS total_pendente,
      COALESCE(SUM(v.desconto), 0) AS descontos,
      COUNT(DISTINCT CASE WHEN v.cliente_avulso_id IS NOT NULL
        THEN 'A:' || v.cliente_avulso_id ELSE 'C:' || v.cliente_id END) AS clientes_atendidos
    FROM visitas v WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
  `).bind(...params).first();

  const produtos = await env.DB.prepare(`
    SELECT vi.produto_nome, COALESCE(SUM(vi.quantidade), 0) AS quantidade,
      COALESCE(SUM(vi.subtotal), 0) AS total
    FROM visita_itens vi INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    GROUP BY vi.produto_nome ORDER BY quantidade DESC
  `).bind(...params).all();

  const formas = await env.DB.prepare(`
    SELECT COALESCE(NULLIF(v.forma_pagamento, ''), 'não informado') AS forma_pagamento,
      COUNT(*) AS vendas, COALESCE(SUM(v.valor_total), 0) AS total,
      COALESCE(SUM(v.valor_recebido), 0) AS recebido
    FROM visitas v WHERE v.comprou = 'sim' AND v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    GROUP BY COALESCE(NULLIF(v.forma_pagamento, ''), 'não informado') ORDER BY total DESC
  `).bind(...params).all();

  const visitas = await env.DB.prepare(`
    SELECT v.*, COALESCE(c.nome_fantasia, c.razao_social, c.nome_estabelecimento,
      ca.nome_estabelecimento, 'Consumidor') AS cliente_nome, vd.nome AS vendedor_nome
    FROM visitas v LEFT JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN clientes_avulsos ca ON ca.id = v.cliente_avulso_id
    LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    ORDER BY v.data_visita DESC, v.id DESC
  `).bind(...params).all();

  const itensVendas = await env.DB.prepare(`
    SELECT vi.visita_id, vi.produto_id, vi.produto_nome, vi.quantidade,
      vi.preco_unitario, vi.subtotal
    FROM visita_itens vi INNER JOIN visitas v ON v.id = vi.visita_id
    WHERE v.data_visita BETWEEN ? AND ?${filtro} AND ${filtroTeste}
    ORDER BY vi.visita_id DESC, vi.id
  `).bind(...params).all();

  const resumoVendedores = user.role === "admin"
    ? await env.DB.prepare(`
      SELECT v.vendedor_id, COALESCE(vd.nome, 'Vendedor') AS vendedor_nome,
        COUNT(*) AS visitas, SUM(CASE WHEN v.comprou = 'sim' THEN 1 ELSE 0 END) AS vendas,
        COALESCE(SUM(v.valor_total + v.desconto), 0) AS total_bruto,
        COALESCE(SUM(v.desconto), 0) AS descontos,
        COALESCE(SUM(v.valor_total), 0) AS total_liquido,
        COALESCE(SUM(v.valor_recebido), 0) AS total_recebido,
        COALESCE(SUM(v.valor_total - v.valor_recebido), 0) AS total_pendente
      FROM visitas v LEFT JOIN vendedores vd ON vd.id = v.vendedor_id
      WHERE v.data_visita BETWEEN ? AND ? AND ${filtroTeste}
      GROUP BY v.vendedor_id, vd.nome ORDER BY total_liquido DESC
    `).bind(dataInicial, dataFinal).all()
    : { results: [] };

  const itensPorVisita = new Map();
  for (const item of itensVendas.results || []) {
    const chave = Number(item.visita_id);
    if (!itensPorVisita.has(chave)) itensPorVisita.set(chave, []);
    itensPorVisita.get(chave).push(item);
  }
  const vendasDetalhadas = (visitas.results || []).map(visita => ({
    ...visita,
    itens: itensPorVisita.get(Number(visita.id)) || []
  }));

  return json({ data_inicial: dataInicial, data_final: dataFinal, registros_teste: somenteTeste, resumo,
    formas_pagamento: formas.results || [], resumo_vendedores: resumoVendedores.results || [],
    produtos: produtos.results || [], visitas: vendasDetalhadas });
}

async function listarVendedores(env, user) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const result = await env.DB.prepare(`
    SELECT id, nome, email, role, status, created_at
    FROM vendedores
    ORDER BY nome
  `).all();

  return json(result.results || []);
}

async function criarVendedor(request, env, user) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const d = await request.json();

  const nome = normalizeText(d.nome);
  const email = normalizeText(d.email).toLowerCase();
  const senha = normalizeText(d.senha || d.senha_hash);
  const role = normalizeText(d.role || "vendedor");
  const status = normalizeText(d.status || "ativo");

  if (!nome || !email || !senha) {
    return json({ error: "Nome, e-mail e senha são obrigatórios." }, 400);
  }

  const existe = await env.DB.prepare(
    "SELECT id FROM vendedores WHERE email = ?"
  ).bind(email).first();

  if (existe) {
    return json({ error: "Já existe vendedor com este e-mail." }, 409);
  }

  const res = await env.DB.prepare(`
    INSERT INTO vendedores (nome, email, senha_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(nome, email, senha, role, status).run();

  return json({
    success: true,
    id: res.meta.last_row_id,
    vendedor: { nome, email, role, status }
  });
}

async function atualizarVendedor(request, env, user, id) {
  if (user.role !== "admin") {
    return json({ error: "Acesso restrito ao administrador" }, 403);
  }

  const d = await request.json();

  const atual = await env.DB.prepare(
    "SELECT * FROM vendedores WHERE id = ?"
  ).bind(id).first();

  if (!atual) {
    return json({ error: "Vendedor não encontrado." }, 404);
  }

  const nome = normalizeText(d.nome || atual.nome);
  const email = normalizeText(d.email || atual.email).toLowerCase();
  const senha = normalizeText(d.senha || d.senha_hash || atual.senha_hash);
  const role = normalizeText(d.role || atual.role || "vendedor");
  const status = normalizeText(d.status || atual.status || "ativo");

  await env.DB.prepare(`
    UPDATE vendedores
    SET nome = ?, email = ?, senha_hash = ?, role = ?, status = ?
    WHERE id = ?
  `).bind(nome, email, senha, role, status, id).run();

  return json({
    success: true,
    vendedor: { id, nome, email, role, status }
  });
}

async function debugClientes(request, env, user) {
  const url = new URL(request.url);
  const [clientes, vendedores, visitas, listaClientes] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM clientes").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM vendedores").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM visitas").first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM clientes c
      LEFT JOIN vendedores vd ON vd.id = c.vendedor_id
    `).first(),
  ]);

  return json({
    user: {
      id: user.vendedorId,
      role: user.role,
    },
    db: {
      clientes: clientes?.total ?? 0,
      vendedores: vendedores?.total ?? 0,
      visitas: visitas?.total ?? 0,
    },
    consultas: {
      listarClientes: listaClientes?.total ?? 0,
    },
    binding: "DB",
    diagnostico: "debug-clientes-2026-08-01",
    hostname: url.hostname,
    pathname: url.pathname,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

 if (request.method === "OPTIONS") {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

    if (url.pathname === "/" || url.pathname === "/api/health") return health(env);
    if (url.pathname.startsWith("/api/cnpj/") && request.method === "GET") {
  return consultarCNPJ(request);
}
    if (url.pathname === "/api/login" && request.method === "GET") {
      return json({ status: "ok", rota: "/api/login", metodo: "use POST" });
}

    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);

    const user = await getUser(request);
    if (!user) return json({ error: "Não autorizado" }, 401);

if (url.pathname === "/api/vendedores" && request.method === "GET") {
  return listarVendedores(env, user);
}

if (url.pathname === "/api/vendedores" && request.method === "POST") {
  return criarVendedor(request, env, user);
}

if (url.pathname.startsWith("/api/vendedores/") && request.method === "PUT") {
  const id = Number(url.pathname.split("/").pop());
  return atualizarVendedor(request, env, user, id);
}

    if (url.pathname === "/api/debug-clientes" && request.method === "GET") return debugClientes(request, env, user);
    if (url.pathname === "/api/clientes" && request.method === "GET") return listarClientes(env, user);
    if (url.pathname === "/api/clientes" && request.method === "POST") return criarCliente(request, env, user);
    if (url.pathname === "/api/clientes-avulsos" && request.method === "GET") return listarClientesAvulsos(env);
    if (url.pathname === "/api/clientes-avulsos" && request.method === "POST") return criarClienteAvulso(request, env, user);
    if (url.pathname === "/api/sync" && request.method === "GET") {
  return json({ status: "ok", rota: "/api/sync", metodo: "use POST" });
}

if (url.pathname === "/api/sync" && request.method === "POST") {
  return sync(request, env, user);
}

    if (url.pathname === "/api/produtos" && request.method === "GET") return listarProdutos(request, env, user);
    if (url.pathname === "/api/produtos" && request.method === "POST") return gerirProduto(request, env, user);
    if (url.pathname.startsWith("/api/produtos/") && request.method === "PUT") {
      return gerirProduto(request, env, user, Number(url.pathname.split("/").pop()));
    }
    if (url.pathname === "/api/visitas" && request.method === "GET") return listarVisitas(request, env, user);
    if (url.pathname === "/api/visitas" && request.method === "POST") return criarVenda(request, env, user);
    if (url.pathname === "/api/relatorio-testes" && request.method === "GET") return relatorioPeriodo(request, env, user, true);
    if (url.pathname === "/api/relatorio-dia" && request.method === "GET") return relatorioPeriodo(request, env, user, false);
    return json({ error: "Rota não encontrada" }, 404);
    } catch (err) {
      return json({
        error: "Erro interno no Worker",
        detalhe: err.message,
      }, 500);
    }
  },
};
