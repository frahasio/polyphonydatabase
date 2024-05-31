class CreateClefInclusion < ActiveRecord::Migration[7.1]
  class Clef < ApplicationRecord; end
  class ClefCombination < ApplicationRecord
    attr_accessor :display
  end

  def change
    create_table :clef_inclusions do |t|
      t.string :clef, null: false

      t.references :inclusion, null: false

      t.boolean :missing, null: false, default: false
      t.boolean :incomplete, null: false, default: false
      t.boolean :optional, null: false, default: false
      t.string :transitions_to, array: true, null: false, default: []

      t.timestamps
    end

    reversible do |dir|
      dir.up do
        clefs = Clef.all.index_by(&:id)

        progressbar = ProgressBar.create(total: Inclusion.count)
        insertions = Inclusion.includes(:source, :clef_combination).find_each.with_object([]) do |i, array|
          progressbar.increment
          next unless (combo = i.clef_combination).present?

          clefs.values_at(*combo.clef_ids).each { |clef|
            entry = {
              inclusion_id: i.id,
              clef: clef.note,
              optional: clef.optional?,
              transitions_to: i.transitions_to[clef.id.to_s]&.split("/").presence || [],
              missing: false,
              incomplete: false,
              created_at: combo.updated_at,
              updated_at: combo.updated_at,
            }

            both = i.both_clef_ids.dup
            incomplete = i.incomplete_clef_ids.dup
            missing = i.missing_clef_ids.dup

            if both.include?(clef.id)
              entry[:missing] = true
              entry[:incomplete] = true
              both.delete_at(both.index(clef.id))
            elsif incomplete.include?(clef.id)
              entry[:incomplete] = true
              incomplete.delete_at(incomplete.index(clef.id))
            elsif missing.include?(clef.id)
              entry[:missing] = true
              missing.delete_at(missing.index(clef.id))
            end

            array << entry
          }
        end

        ClefInclusion.insert_all!(insertions)
      end
    end

    add_index :clef_inclusions, [:clef, :inclusion_id]
    add_index :clef_inclusions, :clef
    add_foreign_key :clef_inclusions, :inclusions
  end
end
