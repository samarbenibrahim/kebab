<?php
/**
 * Commande de groupe (client identifié, table de sa session) :
 *   GET    /api/group                panier commun de la table + partage de la dernière addition
 *   POST   /api/group/items          {items: [{productId, quantity, options: [{optionId}]}]}
 *   DELETE /api/group/items/{id}     retire un de SES articles
 *   POST   /api/group/send           {note?} envoie le panier commun = UNE commande
 *
 * Groupes de choix (permission catalog.manage) :
 *   GET    /api/admin/option-groups
 *   POST   /api/option-groups        {name, multiple, required, max?, options: [{label, priceDelta}]}
 *   PATCH  /api/option-groups/{id}   idem (options : [{id?, label, priceDelta}], liste complète)
 *   DELETE /api/option-groups/{id}   seulement s'il n'est utilisé par aucun produit ni jamais commandé
 *
 * Traduit uniquement les exceptions des services en codes HTTP.
 */
class GroupController
{
    public function __construct(private GroupOrderService $groups, private OptionGroupService $optionGroups)
    {
    }

    public function current(array $session): void
    {
        api_guard(fn() => send_json(200, $this->groups->current($session['client'])));
    }

    public function add(string $raw, array $session): void
    {
        api_guard(fn() => send_json(200, $this->groups->add($session['client'], RequestValidator::parseJsonBody($raw))));
    }

    public function remove($rawId, array $session): void
    {
        api_guard(fn() => send_json(200, $this->groups->remove($session['client'], RequestValidator::validateId($rawId))));
    }

    public function send(string $raw, array $session): void
    {
        api_guard(function () use ($raw, $session) {
            $body = trim($raw) === '' ? [] : RequestValidator::parseJsonBody($raw);
            send_json(201, $this->groups->send($session['client'], $body, $session));
        });
    }

    public function optionGroups(): void
    {
        api_guard(fn() => send_json(200, ['content' => $this->optionGroups->all()]));
    }

    public function createOptionGroup(string $raw, array $session): void
    {
        api_guard(fn() => send_json(201, $this->optionGroups->create(RequestValidator::parseJsonBody($raw), $session)));
    }

    public function updateOptionGroup($rawId, string $raw, array $session): void
    {
        api_guard(fn() => send_json(200, $this->optionGroups->update(RequestValidator::validateId($rawId), RequestValidator::parseJsonBody($raw), $session)));
    }

    public function deleteOptionGroup($rawId, array $session): void
    {
        api_guard(function () use ($rawId, $session) {
            $this->optionGroups->delete(RequestValidator::validateId($rawId), $session);
            send_json(200, ['ok' => true]);
        });
    }
}
