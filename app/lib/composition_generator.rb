class CompositionGenerator
  def self.run
    to_check_composer = Composer.find_or_create_by!(name: "to check")
    anon_composer = Composer.find_by!(name: "Anon")

    Inclusion.where(composition_id: nil).group_by(&:unique_piece).each do |unique_piece, inclusions|
      title = Title.find_or_create_by!(text: unique_piece.title)
      number_of_voices = unique_piece.minimum_voices

      composers = inclusions.flat_map(&:attributions).map {|a|
        if a.incorrectly_attributed?
          to_check_composer
        elsif a.alias.nil?
          anon_composer
        else
          a.alias.composer
        end
      }.uniq

      puts "Creating new composition `#{title.text}`:#{number_of_voices}:`#{composers.map(&:name).join}`"

      if unique_piece.editions.count + unique_piece.recordings.count > 0
        puts "-- Updating #{unique_piece.editions.count} editions and #{unique_piece.recordings.count} recordings on `#{unique_piece.title}`"
      end

      unique_piece.editions.each do |edition|
        next if edition.editor_name.nil?

        editor = Editor.find_or_create_by!(name: edition.editor_name)
        edition.update(editor: editor)
      end

      unique_piece.recordings.each do |recording|
        next if recording.performer_name.nil?

        performer = Performer.find_or_create_by!(name: recording.performer_name)
        recording.update(performer: performer)
      end

      group = Group.create!(
        display_title: title.text,
        editions: unique_piece.editions,
        recordings: unique_piece.recordings,
      )

      composition = Composition.create!(
        number_of_voices: number_of_voices,
        title: title,
        composers: composers,
        group: group,
      )

      puts "-- Creating with #{inclusions.count} inclusions"
      inclusions.each { |i| i.update(composition_id: composition.id) }
    end
  end
end
