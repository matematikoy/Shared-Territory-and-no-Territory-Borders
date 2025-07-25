function TerritoryDecay() {}

TerritoryDecay.prototype.Schema = `
	<element name='DecayRate' a:help='Decay rate in capture points per second'>
		<choice><ref name='positiveDecimal'/><value>Infinity</value></choice>
	</element>
	<element name='Territory' a:help='Specifies territory in which this entity will decay.'>
		<list>
			<oneOrMore>
				<choice>
					<value>neutral</value>
					<value>enemy</value>
				</choice>
			</oneOrMore>
		</list>
	</element>
	`;

TerritoryDecay.prototype.Init = function()
{
	this.decaying = false;
	this.connectedNeighbours = new Array(Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers()).fill(0);
	this.territoryOwnership = !isFinite(+this.template.DecayRate);
};

TerritoryDecay.prototype.IsConnected = function()
{
	this.connectedNeighbours.fill(0);

	var cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition || !cmpPosition.IsInWorld())
		return false;

	var cmpPlayer = QueryOwnerInterface(this.entity);
	if (!cmpPlayer)
		return true;// something without ownership can't decay

	const playerID = cmpPlayer.GetPlayerID();
	const cmpDiplomacy = QueryPlayerIDInterface(playerID, IID_Diplomacy);
	if (!cmpDiplomacy)
		return true;

	const decayTerritory = this.template?.Territory !== undefined ?
		ApplyValueModificationsToEntity("TerritoryDecay/Territory", this.template.Territory, this.entity) :
		[];

	var cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	var pos = cmpPosition.GetPosition2D();
	var tileOwner = cmpTerritoryManager.GetOwner(pos.x, pos.y);
	if (tileOwner == 0)
	{
		cmpTerritoryManager.SetTerritoryBlinking(pos.x, pos.y, false);
		this.connectedNeighbours[0] = 1;
		return playerID == 0 || decayTerritory.indexOf("neutral") === 1;
	}

	var tileConnected = cmpTerritoryManager.IsConnected(pos.x, pos.y);
	if (tileConnected && !cmpDiplomacy.IsMutualAlly(tileOwner))
	{
		this.connectedNeighbours[tileOwner] = 1;
		return decayTerritory.indexOf("enemy") === -1;
	}

	if (tileConnected)
		return true;

	// Special-case: if the tile is unconnected, non-own territory, decay towards gaia.
	// TODO: this is not great, see #4749
	if (playerID != tileOwner)
	{
		this.connectedNeighbours[0] = 1;
		return false;
	}

	this.connectedNeighbours = cmpTerritoryManager.GetNeighbours(pos.x, pos.y, true);

	let numPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetNumPlayers();
	for (var i = 1; i < numPlayers; ++i)
		if (this.connectedNeighbours[i] === 0 && cmpDiplomacy.IsMutualAlly(i))
		{
			// don't decay if connected to a connected ally; disable blinking
			cmpTerritoryManager.SetTerritoryBlinking(pos.x, pos.y, false);
			return true;
		}

	cmpTerritoryManager.SetTerritoryBlinking(pos.x, pos.y, true);
	return false;
};

TerritoryDecay.prototype.IsDecaying = function()
{
	return this.decaying;
};

TerritoryDecay.prototype.GetDecayRate = function()
{
	// Proteção total contra template indefinido
	if (!this.template || this.template.DecayRate === undefined)
		return 0;

	return ApplyValueModificationsToEntity(
		"TerritoryDecay/DecayRate",
		+this.template.DecayRate,
		this.entity);
};


/**
 * Get the number of connected bordering tiles to this region
 * Only valid when this.IsDecaying()
 */
TerritoryDecay.prototype.GetConnectedNeighbours = function()
{
	return this.connectedNeighbours;
};

TerritoryDecay.prototype.UpdateDecayState = function()
{
	let decaying = !this.IsConnected() && this.GetDecayRate() > 0;
	if (decaying === this.decaying)
		return;
	this.decaying = decaying;
	Engine.PostMessage(this.entity, MT_TerritoryDecayChanged, { "entity": this.entity, "to": decaying, "rate": this.GetDecayRate() });
};

TerritoryDecay.prototype.UpdateOwner = function()
{
	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpOwnership || !cmpPosition || !cmpPosition.IsInWorld())
		return;
	let cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	let pos = cmpPosition.GetPosition2D();
	let tileOwner = cmpTerritoryManager.GetOwner(pos.x, pos.y);
	if (tileOwner != cmpOwnership.GetOwner())
		cmpOwnership.SetOwner(tileOwner);
};

TerritoryDecay.prototype.OnTerritoriesChanged = function(msg)
{
	if (this.territoryOwnership)
		this.UpdateOwner();
	else
		this.UpdateDecayState();
};

TerritoryDecay.prototype.OnPositionChanged = function(msg)
{
	if (this.territoryOwnership)
		this.UpdateOwner();
	else
		this.UpdateDecayState();
};

TerritoryDecay.prototype.OnDiplomacyChanged = function(msg)
{
	// Can change the connectedness of certain areas
	if (!this.territoryOwnership)
		this.UpdateDecayState();
};

TerritoryDecay.prototype.OnOwnershipChanged = function(msg)
{
	// Update the list of TerritoryDecay components in the manager
	if (msg.from == INVALID_PLAYER || msg.to == INVALID_PLAYER)
	{
		let cmpTerritoryDecayManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryDecayManager);
		if (msg.from == INVALID_PLAYER)
			cmpTerritoryDecayManager.Add(this.entity);
		else
			cmpTerritoryDecayManager.Remove(this.entity);
	}

	// if it influences the territory, wait until we get a TerritoriesChanged message
	if (!this.territoryOwnership && !Engine.QueryInterface(this.entity, IID_TerritoryInfluence))
		this.UpdateDecayState();
};

TerritoryDecay.prototype.HasTerritoryOwnership = function()
{
	return this.territoryOwnership;
};

Engine.RegisterComponentType(IID_TerritoryDecay, "TerritoryDecay", TerritoryDecay);
