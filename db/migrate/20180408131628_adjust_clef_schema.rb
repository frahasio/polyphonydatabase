class AdjustClefSchema < ActiveRecord::Migration[5.0]
  def change
    drop_table :clef_combinations_clefs
    add_column :clef_combinations, :clef_ids, :integer, array: true, nil: false, default: []
    add_column :inclusions, :missing_clef_ids, :integer, array: true, nil: false, default: []
    add_column :inclusions, :incomplete_clef_ids, :integer, array: true, nil: false, default: []
    add_belongs_to :inclusions, :clef_combination

    duplicated_clef_notes = Clef.group(:note).having("count(*) > 1").count.keys
    duplicated_clef_notes.each do |note|
      clefs = Clef.where(note: note).to_a
      clef_to_keep = clefs.shift
      ClefsInclusion.where(clef: clefs).update_all(clef_id: clef_to_keep.id)
      clefs.each(&:destroy)
    end

    add_index :clefs, :note, unique: true
  end
end
