class Source < ActiveRecord::Base
  self.inheritance_column = :_type_disabled

  validates :code, presence: true, uniqueness: true

  has_many :inclusions, inverse_of: :source
  accepts_nested_attributes_for :inclusions, reject_if: :unfilled?

  scope :uncatalogued, -> { where(catalogued: false) }
  scope :catalogued, -> { where(catalogued: true) }

  TYPES = %w[
    MS
    Print
  ].freeze

  FORMATS = %w[
    Choirbook
    Partbook
    Score
    Unidentifiable/fragment
  ].freeze

  PUBLISHERS_AND_SCRIBES = [
    "Adams, Thomas",
    "Aggere, Antonius de",
    "Alamire, Pierre",
    "Amadino, Ricciardo",
    "Andreae, Hieronymus",
    "Angelieri, Giorgio",
    "Antico, Andrea",
    "Apiarius Mathias",
    "Arnao, Antonio",
    "Arrivabene, Andrea",
    "Attaingnant, Pierre",
    "Baldini, Vittorio",
    "Baldwin, John",
    "Ballard, Robert",
    "Bariletto, Giovanni",
    "Barley, William",
    "Barré, Antoine",
    "Baumann, Georg",
    "Beaumont, Willem van",
    "Bellère, Jean",
    "Beltrano, Ottavio",
    "Berg & Neuber",
    "Berg, Adam",
    "Berg, Johann",
    "Beringen, Godefroy",
    "Berwald, Zacharias",
    "Bevilacqua, Nicolo",
    "Blado, Antonio",
    "Bogard, Jean",
    "Borboni, Nicolo",
    "Bozzola, Tomaso",
    "Brocar, Joan de",
    "Bufalini, Fausto",
    "Buglhat, Johannes de",
    "Byrd, William",
    "Cancer, Matteo",
    "Carlino, Giovanni Giacomo",
    "Castiglione, Giovanni Antonio da",
    "Coattino, Francesco",
    "Correggio, Claudio",
    "Corvinus, Georg",
    "Craesbeeck, Pedro",
    "dall’Aquila, Gioseppe Cacchio",
    "Dalle Donne, Francesco",
    "Day, Richard",
    "dell'Abbate, Antonio",
    "Donangeli, Ascanio",
    "Dorico, Ludovico",
    "Dorico, Valerio",
    "Dow, Robert",
    "Du Bosc, Simon",
    "Du Chemin, Nicolas",
    "East, Thomas",
    "Egenolff, Christian",
    "Eichhorn, Andreas",
    "Eichhorn, Johann",
    "ex typographica regia",
    "Faber, Nicolaus",
    "Fabriano, Jacopo",
    "Fabritius, Julius Paulus",
    "Ferber, August",
    "Ferioli, Gratiadio",
    "Fernández, Francisco",
    "Feyerabend, Sigmund",
    "Flandrum, Joannem",
    "Formschneider, Hieronymus",
    "Galharde, German",
    "Gardano, Alessandro",
    "Gardano, Angelo",
    "Gardano, Antonio",
    "Gargano & Nucci",
    "Gargano, Giovanni Battista",
    "Gehen, Andreas",
    "Gerlach & Neuber",
    "Gerlach, Dietrich",
    "Gerlach, Katharina",
    "Gerlach, Theodor",
    "Giunta, Giacomo",
    "Giunta, Jacomo",
    "Gorlier, Simon",
    "Goudimel, Claude",
    "Gough, John",
    "Goulart, Simon",
    "Grafton, Richard",
    "Grevenbruch, Gerhard",
    "Grimm, Sigismund",
    "Gruppenbach, Georg",
    "Guéroult, Guillaume",
    "Gueynard, Etienne",
    "Guglielmo, Giuseppe",
    "Guldenmundt, Hans",
    "Günther, Hans",
    "Günther, Wolfgang",
    "Gutknecht, Christoff",
    "Haller, Jan",
    "Hanelle, Jean",
    "Hantzsch, Andreas",
    "Hantzsch, Georg",
    "Haultin, Pierre",
    "Hernandez, Diego",
    "Heyden, Marx von der",
    "Hucher, Antonio",
    "Hume, Tobias",
    "Jobin, Bernhard",
    "Johannes dictus Primarius",
    "Johannes le Fauconer, Magister",
    "Jullet, Herbert",
    "Kauffmann, Paul",
    "Kellner, Andreas",
    "Kirchner, Wolfgang",
    "Knorr, Nikolaus",
    "Kriesstein, Melchior",
    "Kröner, Michael",
    "Laet, Jean, Vve",
    "Le Roy & Ballard",
    "Le Roy, Adrian",
    "Lehmann, Zacharias",
    "León, Juan de",
    "Lomazzo, Filippo",
    "Lucius, Jacob",
    "Magni, Bartolomeo",
    "Marchetti, Pietro Maria",
    "Marcolini, Francesco",
    "Masotti, Paolo",
    "Mayer, Johann",
    "Mazzocchi, Giacomo",
    "Merulo, Claudio",
    "Moderne, Jacques",
    "Montedosca, Martin de",
    "Morley, Thomas",
    "Moscheni, Francesco",
    "Mutii, Nicolo",
    "Neuber, Ulrich",
    "Nigrinus, Georg",
    "Nucci, Lucrezio",
    "Ocharte, Pedro",
    "Öglin, Erhard",
    "Oridryus, Johannes",
    "Osterberger, Georg",
    "Ott, Hans",
    "Pasoti, Giovanni Giacomo",
    "Pesnot, Charles",
    "Petreius, Johann",
    "Petrucci, Ottaviano",
    "Petrucci, Pietro Giacomo",
    "Petrus optimus notator, Magister",
    "Petrus, Heinrich",
    "Phalèse the Elder, Pierre",
    "Phalèse the Younger, Pierre",
    "Pietrasanta, Plinio",
    "Plantin, Christophe",
    "Plousiadenos, Joannes",
    "Ponzio, Paolo Gottardo",
    "Pyper, John",
    "Rab, Christoph",
    "Ragazzoni, Ottavio",
    "Rampazetto, Francesco",
    "Rastell, John",
    "Raverii, Alessandro",
    "Rhau, Georg",
    "Robletti, Giovanni Battista",
    "Roderici, Johannes",
    "Rolla, Giorgio",
    "Rossi, Giovanni",
    "Sabbio, Vincenzo",
    "Sambonetti, Pietro",
    "Sanchez, Francisco",
    "Scharffenberg, Crispin",
    "Scharffenberg, Johann",
    "Schoeffer, Peter",
    "Schönigk, Valentin",
    "Schwenck, Lorenz",
    "Schwertel, Johann",
    "Scotto, Girolamo",
    "Scotto, Ottavio",
    "Seklucjan, Jan",
    "Seres, William",
    "Short, Peter",
    "Siebeneicher, Matthäus",
    "Singriener, Hans",
    "Soldi, Luca Antonio",
    "Stephani, Clemens",
    "Stigliola, Nicola Antonio",
    "Stöckel, Matthes",
    "Sultzbach, Johannes",
    "Susato, Tylman",
    "Symon de Sacaglia, Magister",
    "Theobaldus Gallicus",
    "Thomas de Sancto Juliano",
    "Thomassini, Filippo",
    "Tini, Francesco",
    "Tini, Francesco & Simone",
    "Tini, Michele",
    "Tini, Simone",
    "Torresani, Andrea",
    "Tradate, Agostino",
    "Ulhart, Philipp",
    "Vautrollier, Thomas",
    "Verhaghen, Peeter",
    "Verovio, Simone",
    "Vincent, Barthelemi",
    "Vincenti, Giacomo",
    "Vioto, Seth",
    "Vissenaecken, Willem van",
    "Vitale, Constantino",
    "Vorsterman, Guillaume",
    "Waelrunt, Hubert",
    "Welack, Matthäus",
    "Widmanstetter, Georg",
    "Wietor, Hieronim",
    "Wirsung, Marcus",
    "Wyriot, Nikolaus",
    "Wyssenbach, Rudolf",
    "Yonge, Nicholas",
    "Zacara da Teramo, Antonio",
    "Zannetti, Bartolomeo",
    "Zetzner, Lazarus",
  ].freeze

  def dates
    [
      "#{from_year_annotation}#{from_year}",
      "#{to_year_annotation}#{to_year}",
    ].reject(&:blank?).join("-")
  end

  def location_and_pubscribe
    [town, publisher_or_scribe].reject(&:blank?).join(": ")
  end

private

  def unfilled?(attrs)
    unfilled_attributions?(attrs) && unfilled_piece?(attrs)
  end

  def unfilled_attributions?(attrs)
    return true unless attrs.has_key?(:attributions_attributes)

    attrs[:attributions_attributes].values.all? do |attribution|
      attribution[:anonym_attributes] && attribution[:anonym_attributes].values.all?(&:blank?)
    end
  end

  def unfilled_piece?(attrs)
    return true unless attrs.has_key?(:piece_attributes)

    attrs[:piece_attributes].values.all?(&:blank?)
  end
end
