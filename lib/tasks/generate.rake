namespace :generate do
  desc "Sets up the database according to the new schema"
  task all: :environment do
    %w[
      compositions
      feasts
      new_attributions
      publishers_and_scribes
      clef_combinations
    ].each do |task|
      puts "Generating #{task}"
      Rake::Task["generate:#{task}"].invoke
    end
  end

  desc "Creates compositions based on inclusions etc."
  task compositions: :environment do
    CompositionGenerator.run
  end

  desc "Creates feasts"
  task feasts: :environment do
    Feast::FEASTS.each do |code, name|
      titles = FeastsUniquePiece.where(feast_code: code).map {|fup|
        fup.unique_piece&.title
      }.compact

      if titles.count > 0
        puts "Creating feast `#{name}` with #{titles.count} titles"
      end

      Function.create!(
        name: name,
        titles: Title.where(text: titles.uniq),
      )
    end
  end

  desc "Updates attributions"
  task new_attributions: :environment do
    print "Updating attributions"
    Attribution
      .where(incorrectly_attributed: false)
      .includes(:anonym, alias: :anonym)
      .find_each do |attribution|
        attribution.update(
          text: attribution.anonym_name,
          refers_to: attribution.alias&.composer,
        )
        print "."
      end

    to_check_composer = Composer.find_or_create_by!(name: "to check")
    anon_composer = Composer.find_or_create_by!(name: "Anon")

    Attribution
      .where(incorrectly_attributed: true)
      .joins(:anonym)
      .find_each do |attribution|
        attribution.update(
          text: attribution.anonym_name,
          refers_to: to_check_composer,
        )
        print "."
      end

    Attribution
      .where(incorrectly_attributed: true)
      .left_outer_joins(:anonym)
      .where(anonyms: {id: nil})
      .find_each do |attribution|
        attribution.update(
          refers_to: anon_composer,
        )
        print "."
      end

    puts " done."
  end

  desc "Loads publishers and scribes into the database"
  task publishers_and_scribes: :environment do
    publishers = [
      "Adams, Thomas",
      "Aggere, Antonius de",
      "Allde, Edwin",
      "Amadino, Ricciardo",
      "Andreae, Hieronymus",
      "Angelieri, Giorgio",
      "Antico, Andrea",
      "Apiarius Mathias",
      "Arbilius, Jakob",
      "Arnao, Antonio",
      "Arrivabene, Andrea",
      "Attaingnant, Pierre",
      "Baldini, Vittorio",
      "Ballard, Pierre",
      "Ballard, Robert",
      "Bariletto, Giovanni",
      "Barley, William",
      "Barré, Antoine",
      "Basae, Dominici",
      "Baumann, Georg",
      "Beaumont, Willem van",
      "Bellère, Jean",
      "Beltrano, Ottavio",
      "Berg, Adam",
      "Berg, Johann",
      "Beringen, Godefroy",
      "Berwald, Zacharias",
      "Betzel, Andreas",
      "Bevilacqua, Nicolo",
      "Birckmanns, Arnold",
      "Birnstiel, Heinrich",
      "Blado, Antonio",
      "Bogard, Jean",
      "Borboni, Nicolo",
      "Bozzola, Tomaso",
      "Brocar, Joan de",
      "Bufalini, Fausto",
      "Buglhat, Johannes de",
      "Byrd, William",
      "Campis, Henrici de",
      "Cancer, Matteo",
      "Carlino, Giovanni Giacomo",
      "Castiglione, Giovanni Antonio da",
      "Channay, Jean de",
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
      "Formica, Leonhard",
      "Formschneider, Hieronymus",
      "Galharde, German",
      "Gardano, Alessandro",
      "Gardano, Angelo",
      "Gardano, Antonio",
      "Gargano, Giovanni Battista",
      "Gehen, Andreas",
      "Gerlach, Dietrich",
      "Gerlach, Katharina",
      "Gerlach, Theodor",
      "Giunta, Giacomo",
      "Giunta, Jacomo",
      "Godbid, William",
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
      "Hanlin, Gregor",
      "Hantzsch, Andreas",
      "Hantzsch, Georg",
      "Hartmann, Friedrich",
      "Hauck, Justus",
      "Haultin, Pierre",
      "Henricum, Nicolaum",
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
      "Kieffer, Carl",
      "Kirchner, Wolfgang",
      "Knorr, Nikolaus",
      "Kriesstein, Melchior",
      "Kröner, Michael",
      "Laet, Jean, Vve",
      "Lazaris, Ignatius de",
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
      "Meltzer, Adam",
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
      "Redmer, Richard",
      "Reinmichaelius, Leonhardus",
      "Rhau, Georg",
      "Robletti, Giovanni Battista",
      "Roderici, Johannes",
      "Rolla, Giorgio",
      "Rossi, Giovanni",
      "Sabbio, Vincenzo",
      "Saint-André, Pierre de",
      "Sambonetti, Pietro",
      "Sanchez, Francisco",
      "Sartorius, Nicolaus",
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
      "Snodham, Thomas",
      "Soldi, Luca Antonio",
      "Stansby, William",
      "Stein, Nikolaus",
      "Stephani, Clemens",
      "Stigliola, Nicola Antonio",
      "Stöckel, Mattheus",
      "Sultzbach, Johannes",
      "Susato, Tylman",
      "Symon de Sacaglia, Magister",
      "Theobaldus Gallicus",
      "Thomas de Sancto Juliano",
      "Thomassini, Filippo",
      "Tini, Francesco",
      "Tini, Michele",
      "Tini, Simone",
      "Torresani, Andrea",
      "Tradate, Agostino",
      "Tusculanus, Biondiono",
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

    scribes = [
      "Alamire, Pierre",
      "Baldwin, John",
      "Dow, Robert",
      "Higgons, Edward",
    ].freeze

    pairs = {
      "Berg & Neuber" => ["Berg, Johann","Neuber, Ulrich"],
      "Beringen, Godefroy & Marcel" => ["Beringen, Godefroy","Beringen, Marcel"],
      "Buglhat, Campis, & Hucher" => ["Buglhat, Johannes de","Campis, Henrici de","Hucher, Antonio"],
      "Corvinus & Feyerabend" => ["Corvinus, Georg","Feyerabend, Sigmund"],
      "Dorico, Valerio & Luigi" => ["Dorico, Valerio","Dorico, Luigi"],
      "Gargano & Nucci" => ["Gargano, Giovanni Battista","Nucci, Lucrezio"],
      "Gerlach & Berg" => ["Gerlach, Katharina","Berg, Johann"],
      "Gerlach & Neuber" => ["Gerlach, Katharina","Neuber, Ulrich"],
      "Gerlach, Katharina & Theodor" => ["Gerlach, Katharina","Gerlach, Theodor"],
      "Grimm & Wirsung" => ["Grimm, Sigismund","Wirsung, Marcus"],
      "Le Roy & Ballard" => ["Le Roy, Adrian","Ballard, Robert"],
      "Lownes, Browne, & Snodham" => ["Snodham, Thomas","Lownes, Matthew","Browne, John"],
      "Moscheni, Francesco & Simone" => ["Moscheni, Francesco","Moscheni, Simone"],
      "Phalèse & Bellère" => ["Phalèse the Elder, Pierre","Bellère, Jean"],
      "Tini & Besozzi" => ["Besozzi, Giovanni Francesco","Tini, Simone"],
      "Tini, Francesco & Simone" => ["Tini, Francesco","Tini, Simone"],
      "Vincenti & Amadino" => ["Vincenti, Giacomo","Amadino, Ricciardo"],
    }

    publishers.each do |publisher_name|
      sources = Source.where(publisher_or_scribe: publisher_name)
      puts "Creating publisher `#{publisher_name}` with #{sources.count} sources"

      Publisher.create!(
        name: publisher_name,
        sources: sources,
      )
    end

    scribes.each do |scribe_name|
      sources = Source.where(publisher_or_scribe: scribe_name)
      puts "Creating scribe `#{scribe_name}` with #{sources.count} sources"

      Scribe.create!(
        name: scribe_name,
        sources: sources,
      )
    end

    pairs.each do |pair, publishers|
      sources = Source.where(publisher_or_scribe: pair)
      Publisher.where(name: publishers).each do |publisher|
        publisher.update(sources: publisher.sources + sources)
      end
    end
  end

  desc "Creates ClefCombination objects for blank inclusions"
  task clef_combinations: :environment do
    Inclusion.where(clef_combination_id: nil).find_each do |inclusion|
      inclusion.display_clefs = inclusion.clefs_inclusions.map(&:annotated_note).reject(&:blank?)
      puts "Saving clef combination #{inclusion.clef_combination_id} for inclusion #{inclusion.id}"
      inclusion.save!
    end
  end
end
