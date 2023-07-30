require "csv"

# FIXME: This can be deleted once the import is complete,
# along with the contents of `lib/one_off_import_data/`.
class OneOffImport
  def self.import
    ActiveRecord::Base.transaction do
      new.import
    end
  end

  def import
    Rails.logger.warn("[One off import] Beginning import")
    import_composition_types
    import_title_data
    import_composition_data
    Rails.logger.warn("[One off import] Import complete")
  end

  private

  def import_composition_types
    %w[
      Alleluia
      Canticle
      Hymn
      Instrumental
      Introit
      Lamentation
      Litany
      Mass
      Motet
      Passion
      Psalm
      Response
      Responsory
      Service
      Short responsory
      Song
    ].each do |name|
      CompositionType.find_or_create_by!(name:)
    end
  end

  def import_title_data
    Rails.logger.warn("[One off import] Importing title data")
    CSV.foreach(title_data_path, headers: true) do |row|
      if (title = Title.find_by(id: row["id"]))
        title.update!(language: row["language"])
      else
        Rails.logger.warn("[One off import] No title found with id `#{row['id']}`")
      end
    end

    Title.where.not(language: Title::LANGUAGES).update_all(language: nil)
  end

  def title_data_path
    Rails.root.join("app/lib/one_off_import_data/title_data.csv")
  end

  def import_composition_data
    Rails.logger.warn("[One off import] Importing composition data")

    Composition.where.not(tone: Composition::TONES.keys).update_all(tone: nil)
    Composition.where.not(even_odd: Composition::EVEN_ODD.keys).update_all(even_odd: nil)

    CSV.foreach(composition_data_path, headers: true) do |row|
      title = Title.find_by(id: row["title_id"])
      if title.nil?
        Rails.logger.warn("[One off import] No title found with id `#{row['title_id']}`")
        next
      end

      group = Group.find_by(id: row["group_id"])
      if group.nil?
        Rails.logger.warn("[One off import] No group found with id `#{row['group_id']}`")
        next
      end

      if (composition = Composition.find_by(id: row["composition_id"]))
        composition.update!(
          composition_type: CompositionType.find_by(name: row["type"]),
          even_odd: row["even_odd"].presence,
          tone: row["tone"].presence,
          title:,
          group:,
        )
      else
        Rails.logger.warn("[One off import] No composition found with id `#{row['composition_id']}`")
      end
    end
  end

  def composition_data_path
    Rails.root.join("app/lib/one_off_import_data/composition_data.csv")
  end
end
