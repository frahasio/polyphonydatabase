class DeleteOldSchema < ActiveRecord::Migration[5.0]
  def change
    drop_table :aliases
    drop_table :anonyms
    remove_columns :attributions,
      :alias_id,
      :anonym_id,
      :composer_id,
      :incorrectly_attributed
    drop_table :clefs_inclusions
    drop_table :composers_unique_pieces
    remove_columns :editions,
      :editor_name,
      :unique_piece_id
    drop_table :feasts_unique_pieces
    remove_columns :inclusions,
      :piece_id,
      :unique_piece_id,
      :public_notes
    drop_table :pieces
    remove_column :recordings, :performer_name
    remove_column :sources, :publisher_or_scribe
    drop_table :unique_pieces
  end
end
