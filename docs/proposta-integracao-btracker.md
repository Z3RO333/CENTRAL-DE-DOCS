# Proposta: Integração de Pré-preenchimento de NFS-e com o BTracker

**De:** Gustavo Andrade — Diretoria Operacional / Central de Formulários
**Para:** Time do BTracker / TI
**Data:** 03/06/2026
**Assunto:** Autorização para integração de importação automática de NFS-e

---

## 1. Contexto

Hoje, o recebimento de notas fiscais de serviço dos prestadores de manutenção passa por digitação manual no BTracker (tela *Adicionar NFS-e*). O prestador envia a NF (e o boleto) pela nossa **Central de Formulários**, e a equipe relança manualmente os mesmos dados no BTracker — retrabalho sujeito a erro, principalmente em valores, tributos e retenções.

## 2. O que já construímos (do nosso lado)

Na Central de Formulários implementamos uma camada de **extração e conferência fiscal automática** das NFs recebidas:

- **Leitura do documento** via XML (quando disponível) ou OCR + IA para PDF/imagem.
- **Conferência fiscal** com regras da **Zona Franca de Manaus** (Tema 1.239 do STJ / MS Bemol nº 1003277-78.2019.4.01.3200): alerta de PIS/COFINS destacados indevidamente em operações ZFM.
- **Validação de cálculos**: base de cálculo, retenções (ISS retido, PIS, COFINS, CSLL, IRRF, INSS) e valor líquido, com classificação de risco e identificação do regime tributário do prestador.
- **Tela de revisão** onde o operador confere campo a campo antes de qualquer envio.

Resultado: os dados chegam **mais corretos e já conferidos** do que na digitação manual.

## 3. O que pedimos

Autorização e a **via oficial** para enviar essas notas já pré-preenchidas ao BTracker, de uma destas formas (o que for melhor para vocês):

- **(Preferencial)** Um **endpoint oficial de importação** de NFS-e, ou
- Liberação/orientação para usarmos o fluxo de criação existente de forma sancionada.

## 4. Situação atual e por que estamos pedindo

Ao testar o envio, observamos que a nota entra corretamente, porém fica **bloqueada automaticamente** até a validação manual na tesouraria. **Entendemos que esse bloqueio é um controle intencional de vocês e o respeitamos** — não temos intenção de contorná-lo por fora.

É justamente por isso que estamos trazendo a proposta formalmente: queremos fazer pela via certa, com o aval e o acompanhamento do time do BTracker, em vez de qualquer solução paliativa.

## 5. Salvaguardas

- A **validação da tesouraria e da contabilidade permanece** — a integração só elimina a digitação, não substitui a conferência de vocês.
- Cada envio fica **rastreável** (usuário, documento de origem, data).
- Podemos iniciar com um **piloto restrito** (poucos prestadores / um operador) para validação conjunta antes de qualquer ampliação.

## 6. Próximos passos sugeridos

1. Reunião curta (30 min) para alinhamento técnico.
2. Definição da via oficial de integração (endpoint ou processo).
3. Piloto monitorado.
4. Liberação gradual.

**Contato:** Gustavo Andrade — gustavoandrade@bemol.com.br
