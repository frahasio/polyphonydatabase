class CompositionGenerator
  def self.run
    to_check_composer = Composer.find_or_create_by!(name: "to check")
    anon_composer = Composer.find_by!(name: "Anon")

    UniquePiece.all.order(:id).each do |unique_piece|
      title = Title.find_or_create_by!(text: unique_piece.title)
      number_of_voices = unique_piece.minimum_voices

      composers = unique_piece.inclusions.flat_map(&:attributions).map {|a|
        if a.incorrectly_attributed?
          to_check_composer
        elsif a.alias.nil?
          anon_composer
        else
          a.alias.composer
        end
      }.uniq

      puts "Creating new composition `#{title.text}`:#{number_of_voices}:`#{composers.map(&:name).join}`"
      composition = Composition.new(
        number_of_voices: number_of_voices,
        title: title,
      )

      composition.composers = composers
      composition.inclusions = unique_piece.inclusions

      if unique_piece.editions.count + unique_piece.recordings.count > 0
        puts "-- Updating #{unique_piece.editions.count} editions and #{unique_piece.recordings.count} recordings on `#{unique_piece.title}`"
      end

      unique_piece.editions.each do |edition|
        next if edition.editor_name.nil?

        editor = Editor.find_or_create_by!(name: edition.editor_name)
        edition.editor = editor
      end

      unique_piece.recordings.each do |recording|
        next if recording.performer_name.nil?

        performer = Performer.find_or_create_by!(name: recording.performer_name)
        recording.performer = performer
      end

      composition.group = Group.create!(
        display_title: title.text,
        editions: unique_piece.editions,
        recordings: unique_piece.recordings,
      )

      composition.save!
    end

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
end
