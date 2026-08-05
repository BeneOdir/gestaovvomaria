(function(global){
  const formatadorBRL = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

  function parseMoedaBR(valor){
    if(typeof valor === "number") return Number.isFinite(valor) ? valor : Number.NaN;
    let texto = String(valor ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    if(!texto) return Number.NaN;
    if(texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
    else if((texto.match(/\./g) || []).length > 1){
      const partes = texto.split(".");
      texto = partes.slice(0, -1).join("") + "." + partes.at(-1);
    }
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : Number.NaN;
  }

  function formatarMoedaBR(valor){
    const numero = typeof valor === "number" ? valor : parseMoedaBR(valor);
    return formatadorBRL.format(Number.isFinite(numero) ? numero : 0);
  }

  function aplicarMascaraMoeda(campo, vazioComoZero = true){
    campo.type = "text";
    campo.inputMode = "decimal";
    campo.addEventListener("focus", () => {
      const numero = parseMoedaBR(campo.value);
      campo.value = Number.isFinite(numero) ? String(numero).replace(".", ",") : "";
      campo.select();
    });
    campo.addEventListener("blur", () => {
      const numero = parseMoedaBR(campo.value);
      campo.value = Number.isFinite(numero) ? formatarMoedaBR(numero) : (vazioComoZero ? formatarMoedaBR(0) : "");
    });
  }

  global.parseMoedaBR = parseMoedaBR;
  global.formatarMoedaBR = formatarMoedaBR;
  global.aplicarMascaraMoeda = aplicarMascaraMoeda;
})(globalThis);

